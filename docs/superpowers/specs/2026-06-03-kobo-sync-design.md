# Kobo Sync: Design

Date: 2026-06-03
Status: Approved design, ready for implementation planning
Repo: epubReader (MisLibros)

## 1. Goal

Make a Rakuten Kobo e-reader a first-class second reading surface for MisLibros,
fully on-premise. The book, the reading position, and the highlights/notes are the
same whether the user picks up the Kobo or opens the web reader. Specifically:

- Sideloaded library books appear on the Kobo and can be read there.
- Books that originate on the Kobo are pulled back to the server.
- Reading progress syncs both directions (Kobo <-> web).
- Highlights and notes sync both directions, anchored to the **exact** location in
  the text.

The official Kobo cloud only syncs books purchased from the Kobo store; the user's
own (sideloaded) library and its annotations are invisible to it. This feature
replaces that gap with a self-hosted equivalent.

## 2. Context - what already exists in epubReader

The repo is already a self-hosted reader, so most of the pieces exist:

- **Stack:** Node + Express (ESM JS) + `better-sqlite3`; React + Vite + foliate-js
  web reader; Google auth; deployed behind nginx on systemd (`epubreader.service`,
  port 3100). See `OPS.md`.
- **Data model** (`server/src/db.js`): `users`, `books`, `reading_progress`
  (keyed on EPUB **CFI**), `annotations` (keyed on **CFI**), `ratings`, `groups`,
  `group_members`. Multi-user, per-user book storage at
  `data/books/{userId}/{bookId}.epub`.
- **Conventions:** route factories `createXRouter(db, dataDir)` mounted in
  `server/src/app.js`; `authRequired` middleware sets `req.user.sub` = the user's
  internal id; synchronous prepared statements; EPUB metadata/cover extraction in
  `server/src/epub/parser.js`.

The web reader is therefore effectively the "web app" sub-project already built. New
code is the Kobo-facing layer only. New code uses JavaScript with JSDoc type
annotations, matching the user's stated preference.

### Decision log (from brainstorming)

- Self-hosted, greenfield-style but **integrated into epubReader** (one DB, one
  source of truth - no second service, no DB duplication).
- Device side uses a small **on-device agent** (NickelMenu + shell script), because
  the Kobo sync protocol cannot carry highlights back nor pull device-originated
  books.
- Highlight fidelity: **exact CFI mapping** (not just text-anchored), with
  text-anchoring kept as a fallback.

## 3. Architecture

Two independent channels connect the device to the existing server. Each does what
the other cannot.

```
                  ┌─────────────────────────────────────────────┐
                  │  epubReader server (existing)                │
                  │  Express + better-sqlite3                    │
                  │  source of truth: books, progress,           │
                  │  annotations (now Kobo-aware)                │
                  └──────┬───────────────────────────┬──────────┘
   native Kobo sync      │                           │   agent channel (HTTP)
   /v1/library/sync      │                           │   upload KoboReader.sqlite
   (books → device,      │                           │   + sideloaded books;
    progress ↔)          │                           │   (later) write-back
                  ┌──────┴───────────────────────────┴──────────┐
                  │  Kobo device                                 │
                  │  Nickel (api_endpoint → our server)          │
                  │  + NickelMenu + agent script                 │
                  └─────────────────────────────────────────────┘
                  ┌─────────────────────────────────────────────┐
                  │  Web reader (existing foliate-js client)     │  ── REST ──► same server
                  └─────────────────────────────────────────────┘
```

- **Native Kobo sync channel** - the `api_endpoint` redirect. We implement Kobo's
  REST sync protocol so the device pulls books + covers + metadata with Nickel's own
  UI, and pushes reading progress. Free polished UX for book delivery.
- **Agent channel** - NickelMenu launches a shell script that, on WiFi, uploads the
  device's `KoboReader.sqlite` (the only place 100% of highlights/notes live) and any
  sideloaded book files to our server. The server does all parsing; the device script
  stays tiny.

## 4. The Kobo sync protocol (how the server talks to Nickel)

The device reads a single base URL from `.kobo/Kobo/Kobo eReader.conf`:

```ini
[OneStoreServices]
api_endpoint=https://mislibros.openlinks.app/kobo/<device-token>
```

No DNS spoofing or firmware patch - Nickel trusts the URL. Endpoints the server must
answer (reference implementation: Calibre-Web `cps/kobo.py`):

- `GET /v1/library/sync` - returns a JSON changelist (new/changed/deleted books). The
  device pages with a continuation/sync token echoed via header.
- `GET /v1/library/{uuid}/metadata` - per-book metadata.
- cover image endpoints (driven by `image_url_template` keys) and a book **download**
  endpoint that serves the kepub.
- Store/account endpoints the device also calls (`/v1/user/profile`,
  `/v1/analytics/...`, wishlist, recommendations, loyalty) are **stubbed** with empty
  valid responses, or **proxied** to `https://storeapi.kobo.com` so store-bought books
  keep working alongside ours. v1 stubs; proxying is optional later.

HTTPS is mandatory (recent firmware rejects plain HTTP for sync). Reverse proxy must
enlarge buffers (Kobo sends large sync headers) and set `X-Forwarded-Proto=https`.

## 5. Schema additions

Added in `server/src/db.js` using the existing `hasColumn(...)` idempotent-migration
pattern. No destructive changes to existing tables.

```
CREATE TABLE kobo_devices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         TEXT    UNIQUE NOT NULL,   -- the secret in api_endpoint
  name          TEXT,
  last_seen_at  TEXT,
  last_db_hash  TEXT,                       -- hash of last KoboReader.sqlite ingested
  created_at    TEXT DEFAULT CURRENT_TIMESTAMP
);

-- books: add
  kobo_uuid     TEXT    -- stable UUID the device sees (generated on first sync)
  kepub_path    TEXT    -- kepubify output, generated lazily
  source        TEXT NOT NULL DEFAULT 'web'   -- 'web' | 'kobo'

-- reading_progress: add (keep existing cfi/percentage/total_pages)
  kobo_chapter_id        TEXT
  kobo_chapter_progress  REAL
  source                 TEXT   -- 'web' | 'kobo', last writer

-- annotations: add (cfi becomes nullable for unresolved kobo rows)
  kobo_bookmark_id   TEXT UNIQUE   -- BookmarkID from KoboReader.sqlite (dedupe key)
  kobo_start_path    TEXT
  kobo_end_path      TEXT
  kobo_start_offset  INTEGER
  kobo_end_offset    INTEGER
  kobo_chapter_progress REAL
  origin             TEXT NOT NULL DEFAULT 'web'   -- 'web' | 'kobo'
  anchor_status      TEXT DEFAULT 'exact'          -- 'exact' | 'text' | 'unresolved'
```

`annotations.kobo_bookmark_id` is the idempotency key: re-uploading the same
`KoboReader.sqlite` upserts rather than duplicates, so the agent is safe to run on
every WiFi connect.

## 6. New server modules

- `middleware/koboAuth.js` - resolves the URL-path `<device-token>` →
  `kobo_devices` row → `user_id`. Kobo endpoints do **not** use the Google JWT; the
  token is the auth. Touches `last_seen_at`.
- `routes/kobo.js` - the sync protocol (Section 4). Mounted under the token prefix.
- `routes/koboAgent.js` - agent ingestion: `POST .../db` (multer upload of
  `KoboReader.sqlite`) and `POST .../book` (sideloaded file). Auth via `koboAuth`.
- `epub/kepub.js` - wraps **kepubify** to produce the device-facing file; caches at
  `books.kepub_path`.
- `epub/koboDb.js` - opens an uploaded `KoboReader.sqlite` read-only (better-sqlite3)
  and extracts `Bookmark` + `content` rows (highlights, notes, progress, sideloaded
  book list).
- `epub/locations.js` - the exact location-mapping layer (Section 7).
- `device/` - NickelMenu config, the agent shell script, and an install README.

UI: the existing foliate-js reader renders `annotations`; Kobo-origin rows render the
same way once anchored (no new reader work beyond surfacing `anchor_status`).

## 7. Exact location mapping (the core technical design)

### Linchpin assumption (verify first)

kepubify produces the kepub by **inserting** `<span class="koboSpan"
id="kobo.PARAGRAPH.SEGMENT">` wrappers around text segments; it does **not** alter the
text content or its order within a chapter. Therefore the **cumulative character
offset of any point within a chapter's text is identical** in the kepub and in the
original EPUB. This invariance is what makes exact mapping possible without a fragile
format translator. **Implementation step 1 is to verify this** by diffing a kepubified
chapter against its source and confirming text-node concatenation is byte-identical.

### Kobo highlight → CFI (device → web)

Given a `Bookmark` row: `ContentID` (the chapter xhtml inside the kepub),
`StartContainerPath` (e.g. `span#kobo.53.2`), `StartOffset`, and the end pair.

1. Identify the chapter file from `ContentID`.
2. In the kepub chapter, compute the **absolute character offset** of the start point
   = (sum of text length of all koboSpans ordered before `#kobo.53.2`) + `StartOffset`.
   Same for end.
3. By the invariance assumption, that absolute offset addresses the same point in the
   original EPUB chapter. Walk the original chapter's DOM text nodes accumulating
   length until the offset falls inside a node → that node + local offset.
4. Build a CFI from (chapter spine index, node, local offset) for start and end. Store
   on the annotation (`cfi`), keep the Kobo fields too, set `anchor_status='exact'`.

### CFI → Kobo location (web → device)

Reverse: resolve the CFI to a DOM range in the original chapter → absolute char
offsets → find which koboSpan id contains each offset (from the kepub's span map) →
emit `#kobo.P.S` + local offset for start and end.

### Fallback

If a mapping can't be resolved (chapter mismatch, kepub regenerated differently,
missing span), fall back to **text-anchoring**: store the highlighted `text` + chapter
and let the reader re-anchor by searching for that text; set `anchor_status='text'`.
If even that fails, `anchor_status='unresolved'` and the highlight is listed but not
positioned. The reader surfaces these states (e.g. a subtle marker on non-exact
anchors).

### Reading position

Kobo natively tracks position at **chapter + chapterProgress** granularity. Store that
in `reading_progress.kobo_chapter_id` / `kobo_chapter_progress`, and derive a CFI for
the web reader via the same chapter+offset walk (progress fraction → char offset in
chapter). Web→Kobo position uses the reverse. Last-writer-wins on `last_read_at`,
tracked by `source`.

## 8. Device agent

- **Launcher:** NickelMenu (`.adds/nm/config`) adds a "Sync MisLibros" item, plus an
  optional auto-trigger on WiFi connect.
- **Script (busybox sh):** no `sqlite3` needed on-device. It:
  1. copies `/mnt/onboard/.kobo/KoboReader.sqlite` to a temp file,
  2. `POST`s it to `/kobo/<token>/agent/db` via `curl`/`wget` (TLS),
  3. enumerates sideloaded book files not known to the server (manifest compare) and
     uploads new ones to `/kobo/<token>/agent/book`,
  4. logs to a file on the device for debugging.
- **Server** parses the uploaded DB with `epub/koboDb.js`, upserts annotations and
  progress (Section 7), records `last_db_hash` to skip no-op re-ingests.
- **Install:** documented in `device/README.md` - copy a `KoboRoot.tgz` (NickelMenu),
  drop the agent script + config under `.adds/`, edit `api_endpoint`. Fully reversible
  (NickelMenu `uninstall` file; restore `api_endpoint=https://storeapi.kobo.com`).

## 9. Device ↔ user mapping & auth

- The web app gains a small "Devices" area: the user creates a Kobo device, the server
  mints a `kobo_devices.token`, and shows the exact `api_endpoint=...` line + agent
  install steps. One device → one user.
- All Kobo endpoints (sync + agent) authenticate solely via that path token through
  `koboAuth`. The token is as sensitive as a password (anyone with the URL can sync);
  it is shown once and revocable by deleting the device row.

## 10. Deployment

- Already behind nginx + systemd (`OPS.md`). Add nginx buffer bumps for `/kobo/`
  (`proxy_buffer_size 32k; proxy_buffers 4 32k; proxy_busy_buffers_size 64k;`) and
  ensure `X-Forwarded-Proto`.
- **kepubify** binary added to the server host/image; `epub/kepub.js` shells out to it.
- Backend changes require restarting `epubreader.service` (only Jose can; see OPS.md).

## 11. Build order (decomposition)

Each sub-project is its own plan → implementation cycle.

- **A - Book sync to device.** kepubify integration, `routes/kobo.js`, `koboAuth`,
  `kobo_devices` + Devices UI, schema migration, store-endpoint stubs, progress
  receive. Outcome: the user's library appears on the Kobo and reading progress flows
  back. (Web reader already exists.)
- **B - Highlights/notes (device → web), exact mapping.** `routes/koboAgent.js`,
  `epub/koboDb.js`, `epub/locations.js` (verify invariance first), the agent script +
  NickelMenu, rendering Kobo-origin annotations + `anchor_status` in the reader.
  Outcome: every Kobo highlight/note appears at the exact spot in the web reader.
- **B2 - Write-back (web → device).** Inject web-origin highlights and web reading
  position into the device `KoboReader.sqlite` via the agent. Riskiest (mutating the
  live device DB while Nickel may be running); explicitly later and optional.

## 12. Risks & assumptions

- **kepubify text-invariance (linchpin).** Exact mapping depends on it. Verified in
  step 1 of sub-project B; if false, fall back to text-anchoring as primary and
  reconsider exactness.
- **Firmware 5.x.** NickelMenu supports Kobo firmware ~4.6–4.31, not 5.x. Confirm the
  user's device model + firmware before B. Sub-project A (sync protocol) is
  unaffected by firmware.
- **Writing to live KoboReader.sqlite (B2).** Nickel may overwrite concurrent edits;
  needs care (write while Nickel idle, or stage changes). Reason B2 is deferred.
- **Token leakage.** Path-token auth means URL = credential; mitigate with HTTPS only,
  one-time display, revocation.
- **Multi-user safety.** Every Kobo write path resolves to exactly one `user_id` via
  the device token; book/annotation queries stay scoped by `user_id` exactly like the
  existing routes.

## 13. Testing

- Unit: `epub/koboDb.js` against a fixture `KoboReader.sqlite`; `epub/locations.js`
  round-trip (Kobo location → CFI → Kobo location) on a fixture EPUB + its kepub;
  `epub/kepub.js` output shape.
- Route: `routes/kobo.js` sync changelist + download with a seeded device token;
  `routes/koboAgent.js` idempotent re-ingest (same `last_db_hash` is a no-op; same
  `kobo_bookmark_id` upserts).
- Follow existing vitest patterns in `server/tests/`.

## 14. Out of scope (now)

- Store-endpoint **proxying** to Kobo (v1 stubs only).
- Handwritten/stylus annotations (Sage/Elipsa/Libra Colour) beyond what is text in
  `Bookmark`.
- Non-EPUB formats on the Kobo (PDF/CBZ) for highlight mapping.

## 15. Addendum (2026-06-04): sub-project A merged, B/B2 scope + device findings

**Status:** Sub-project A is merged to `main` (PR #2). B work proceeds on
`feature/kobo-sync-b`.

**Firmware confirmed: 4.45.23646** (Libra Colour, the "Monza" 4.x line, released
early 2026). Tooling support verified:
- NickelMenu **v0.6.0+** supports the Libra Colour on 4.4x. The old "~4.31" figure
  was a *tested-range* note, not a ceiling; the only hard incompatibility is
  firmware **5.x, which does not exist** for these devices. KFMon is device-agnostic
  (fw >= 2.9). KOReader works on the Libra Colour.
- Risk retired: the on-device agent approach is viable on this device.

**Highlights source decision:** read **stock Kobo reader** highlights from
`KoboReader.sqlite`. KOReader stores its highlights in per-book sidecar files, NOT
in `KoboReader.sqlite`, so the agent captures only native-reader annotations (the
expected reading path on a stock device).

**Color mapping** (`Bookmark.Color`, conditionally-present integer column on color
devices): `NULL/0` = yellow, `1` = red/pink, `2` = blue, `3` = green. Map to
`annotations.color` hex. Verify on-device with one highlight per color before
relying on it (build .23646 is newer than public docs).

**On-device agent engineering risks (the real ones, not the protocol):**
- **TLS.** Device userland is BusyBox; `wget` has weak/no cert validation and there
  is no `curl` by default. The agent must **bundle a statically-linked `curl` + its
  own CA bundle** for the HTTPS upload. Do not rely on `--no-check-certificate`.
- **WiFi.** Nickel powers WiFi down aggressively. The agent must bring it up
  (`nickel_wifi:autoconnect`) and **poll for connectivity** before uploading.

**Scope expanded:** B2 (web -> device write-back) is now IN scope per the user.

**Decomposition of B + B2 into ordered, shippable plans** (each its own
plan -> subagent-driven execution -> review cycle, like A):

- **B-1 - KEPUB delivery.** Integrate **kepubify**; serve books as KEPUB (lazy,
  cached at `books.kepub_path`) instead of plain EPUB, so device highlights carry
  koboSpans (prerequisite for exact anchoring). One-time library re-sync on device.
  Server-side, unit-testable.
- **B-2 - KoboReader.sqlite ingestion (text-anchored).** `routes/koboAgent.js`
  upload endpoint + `epub/koboDb.js` parser; upsert highlights/notes by
  `kobo_bookmark_id` with color mapping; books-from-device. Highlights land
  text-anchored first. Server-side, unit-testable with a fixture DB.
- **B-3 - Exact CFI mapping.** `epub/locations.js` koboSpan<->CFI via the kepubify
  text-invariance bridge (verify the linchpin assumption first). Promotes
  `anchor_status` to `exact`. Unit-testable with EPUB+kepub fixtures.
- **B-4 - On-device agent.** NickelMenu config + shell script + bundled static
  `curl`/CA + WiFi handling; uploads `KoboReader.sqlite` and new sideloaded books.
  Validated on hardware.
- **B-5 (B2) - Web -> device write-back.** Agent pulls a writeback payload and
  injects web-made highlights (CFI -> koboSpan reverse map) and web reading position
  into the device `KoboReader.sqlite`. Riskiest (mutating the live DB); its own
  design pass (when to write vs Nickel, conflict handling) precedes its plan.

**Progress ownership:** reading position stays on A's native protocol channel
(`/v1/library/:uuid/state`). The sqlite ingestion will NOT also write progress in
B-2 to avoid two writers racing on `reading_progress`; B-5 handles web->device
position separately. `reading_progress.source` (`'web'`|`'kobo'`) + `last_read_at`
remain the last-writer-wins arbiter.
