# Account & data deletion

Date: 2026-06-01

## Goal

Let a signed-in user permanently delete their account and all associated data,
both for user trust and to satisfy app-store data-deletion requirements (a
privacy policy page was just added for the Play Store listing). Deletion is a
hard delete: the user row, every linked record, and the user's files on disk
are removed, with no recovery.

## Scope

- Backend endpoint that performs the hard delete.
- A standalone client page that drives the flow (sign in if needed, confirm,
  delete). No entry point into this page from the existing UI yet; wiring a
  link/button is a separate follow-up task.

Out of scope: token revocation/blacklist, soft-delete/anonymization, any
admin-initiated deletion.

## Backend

### Endpoint

`DELETE /api/auth/account`, added to the existing auth router
(`src/routes/auth.js`) since it is part of the account lifecycle. The auth
router gains the `dataDir` argument (`createAuthRouter(db, dataDir)`) so it can
remove files; `app.js` is updated to pass it. The route uses the existing
`authRequired` middleware applied to just that route.

Request body: `{ "email": "<account email>" }`.

The server loads the user by `req.user.sub`, then compares the supplied email to
the stored email, trimmed and case-insensitive. This guards against accidental
or CSRF-style deletion and mirrors the value the client collects.

Responses:

- `200 { "deleted": true }` on success.
- `400 { "error": "missing_email" }` when no email is supplied.
- `400 { "error": "email_mismatch" }` when the email does not match.
- `404` when the user row is already gone (idempotent-ish for a deleted account).

### Deletion logic

An exported helper `deleteUserAccount(db, dataDir, userId)` (sibling to the
existing `linkPendingMemberships`) so it can be unit-tested directly. The DB
work runs inside a single `db.transaction`, in this order:

1. Capture the ids of groups owned by the user
   (`SELECT id FROM groups WHERE owner_id = ?`).
2. `UPDATE books SET visibility='private', shared=0, share_group_id=NULL
   WHERE share_group_id IN (<those ids>)` — other users' books published into a
   group this user owned get reset to private instead of pointing at a group
   that is about to cascade-delete.
3. `UPDATE books SET visibility='private', shared=0, share_user_id=NULL
   WHERE share_user_id = ?` — books other users shared directly to this user get
   reset to private.
4. `DELETE FROM group_members WHERE user_id IS NULL AND LOWER(email) = LOWER(?)`
   — pending, email-addressed group invitations (these match by email, not
   `user_id`, so the cascade in step 5 cannot reach them).
5. `DELETE FROM users WHERE id = ?` — with `foreign_keys = ON`, this cascades to
   `books`, `annotations`, `ratings`, `groups` the user owns, the user's
   `group_members` rows, and `reading_progress` (via `books`).

After the transaction commits, remove the user's files:
`fs.rmSync(<dataDir>/books/<userId>/, { recursive: true, force: true })`,
wrapped in try/catch. The PII is already gone at this point; a file-removal
failure is logged but does not fail the request (the directory can be swept
later).

### Data-flow notes and accepted limitations

- **Shared content cascades away.** Books this user shared (public/group/user)
  are deleted from everyone's view. This is the intended "remove all traces"
  behavior.
- **Stateless JWT.** There is no token blacklist, so a still-valid token keeps
  passing `authRequired` after deletion. Every route keys on `user_id`/`sub`
  and finds nothing, so the account is effectively dead. The client discards the
  token on success. Token revocation is intentionally out of scope (YAGNI).
- **No rate limiter.** Unlike `/api/auth/google`, this endpoint is
  `authRequired` and self-targeting, so it gets no dedicated limiter.

## Client

### Route and page

New route `/eliminar-cuenta` in `App.jsx` rendering `DeleteAccountPage.jsx`
(Spanish path, matching the existing `/grupos` convention). Nothing links to it
yet; it is reached by direct URL.

The page is a three-state machine:

1. **Not signed in** (`user` is null): heading
   "Inicia sesión para eliminar tu cuenta" and the Google sign-in button. After
   sign-in the page stays on `/eliminar-cuenta` and advances to state 2.
2. **Signed in**: explains the consequences (all books, annotations, ratings,
   groups, and shared content are permanently deleted), an input where the user
   types their account email, and a red "Eliminar mi cuenta" button enabled only
   when the typed email matches `user.email`. Submitting calls
   `api.deleteAccount(email)`.
3. **Deleted** (terminal): on success the page calls `logout()` (which clears
   `user`) and sets a local `deleted` flag. That flag takes precedence over the
   now-logged-out state and shows "Tu cuenta fue eliminada" with a link back to
   `/`. Without the flag, clearing `user` would snap the page back to state 1
   and look like nothing happened.

### Shared sign-in button change

`GoogleSignInButton` currently hardcodes `navigate('/', { replace: true })` on
successful login (both the web GSI callback and the native flow). Add an
optional, backward-compatible prop (e.g. `onSuccess` or `redirectTo`): when
omitted it keeps the current `navigate('/')` so the existing login screen is
unaffected; the delete page passes one that keeps the user on
`/eliminar-cuenta` so it can advance to state 2.

### API client

Add `deleteAccount: (email) => call('/api/auth/account', { method: 'DELETE',
body: { email } })` to `src/lib/api.js`. The existing `call()` helper already
attaches the bearer token and parses JSON / errors.

## Testing

- Backend: new `server/tests/routes.account.test.js` covering:
  - `400` on missing email and on mismatched email.
  - `404` when the account is already gone.
  - Success removes the user row and cascade-removes that user's books,
    annotations, ratings, owned groups, and memberships.
  - Pending email-addressed `group_members` rows are removed.
  - Dangling `share_group_id` / `share_user_id` on other users' books are reset
    to private (not left pointing at deleted rows).
  - The user's files directory is removed from disk.
- Client: verified via `yarn build` / typecheck; no component test harness is
  added for the page in this task.
