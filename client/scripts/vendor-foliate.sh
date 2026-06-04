#!/usr/bin/env bash
#
# Vendor foliate-js (the e-reader engine) into client/public/foliate-js/.
#
# foliate-js is intentionally gitignored and the canonical project is not on npm,
# so the build must fetch it. WITHOUT it the app still builds, but every book read
# fails at runtime with:
#   "Failed to fetch dynamically imported module: .../foliate-js/view.js"
# (the engine is loaded as a static asset from the app origin; see ReaderPage.jsx).
#
# Runs automatically as the prebuild/predev hook (see package.json). Idempotent:
# skips if already vendored. Set FOLIATE_FORCE=1 to refetch. Pinned to a commit
# for reproducible builds; override the commit/branch/tag with FOLIATE_REF.
set -euo pipefail

FOLIATE_REPO="${FOLIATE_REPO:-https://github.com/johnfactotum/foliate-js.git}"
FOLIATE_REF="${FOLIATE_REF:-78914aef4466eb960965702401634c2cb348e9b1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="$SCRIPT_DIR/../public/foliate-js"

# Source maps (*.map) are debug-only and never loaded at runtime. Dropping them
# trims ~1.5 MB (compressed) of pdf.js maps from the shipped app bundle.
# Idempotent: runs on every invocation, including the skip path, so a copy that
# was vendored before this change also gets cleaned on the next build.
strip_maps() {
  find "$DEST" -name '*.map' -type f -delete 2>/dev/null || true
}

if [ -f "$DEST/view.js" ] && [ -z "${FOLIATE_FORCE:-}" ]; then
  strip_maps
  echo "foliate-js already present ($DEST) - skipping fetch (source maps stripped). Set FOLIATE_FORCE=1 to refetch."
  exit 0
fi

echo "Vendoring foliate-js @ ${FOLIATE_REF} from ${FOLIATE_REPO}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
SRC="$TMP/src"
mkdir -p "$SRC"

# Prefer a shallow fetch of the exact commit (cheap); fall back to a full clone
# if the host won't serve that SHA directly.
git -C "$SRC" init -q
git -C "$SRC" remote add origin "$FOLIATE_REPO"
if git -C "$SRC" fetch -q --depth 1 origin "$FOLIATE_REF" 2>/dev/null; then
  git -C "$SRC" checkout -q FETCH_HEAD
else
  echo "Shallow fetch of ${FOLIATE_REF} failed; falling back to full clone."
  rm -rf "$SRC"
  git clone -q "$FOLIATE_REPO" "$SRC"
  git -C "$SRC" checkout -q "$FOLIATE_REF"
fi

rm -rf "$SRC/.git"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$SRC" "$DEST"
strip_maps

if [ ! -f "$DEST/view.js" ]; then
  echo "ERROR: foliate-js vendoring failed - $DEST/view.js missing." >&2
  exit 1
fi
echo "foliate-js vendored: $(find "$DEST" -type f | wc -l) files at $DEST (source maps stripped)"
