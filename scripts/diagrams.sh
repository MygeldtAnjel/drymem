#!/usr/bin/env sh
# Validate and render every diagram in docs/diagrams with archify (tt-a1i/archify),
# pinned to one commit so a renderer change cannot silently move the pictures.
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC="$ROOT/docs/diagrams"
OUT="$SRC/html"
SVG_OUT="$ROOT/apps/landing/public/diagrams"
CACHE="${DRYMEM_ARCHIFY_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/drymem/archify}"
REPO=https://github.com/tt-a1i/archify.git
REV=72c750bb070d95171dbb2244e5b62b1b7da69c12

if [ ! -d "$CACHE/.git" ]; then
  git clone --quiet "$REPO" "$CACHE"
fi
git -C "$CACHE" fetch --quiet origin "$REV" 2>/dev/null || true
git -C "$CACHE" checkout --quiet "$REV"
if [ ! -d "$CACHE/archify/node_modules" ]; then
  (cd "$CACHE/archify" && npm install --silent)
fi

mkdir -p "$OUT"
status=0
for f in "$SRC"/*.json; do
  name=$(basename "$f" .json)   # 04-skill-distribution.workflow
  type=${name##*.}              # workflow
  stem=${name%.*}               # 04-skill-distribution
  if (cd "$CACHE/archify" && node bin/archify.mjs validate "$type" "$f" >/dev/null 2>&1 \
      && node bin/archify.mjs render "$type" "$f" "$OUT/$stem.html" >/dev/null 2>&1); then
    # Also lift the picture out as a standalone SVG for the documentation site.
    # The HTML page is for opening on its own; a docs page wants one scalable
    # image that follows the reader's theme, not 800 KB of explorer.
    node "$ROOT/scripts/diagram-svg.mjs" "$OUT/$stem.html" "$SVG_OUT" "$stem" >/dev/null
    echo "ok   $stem"
  else
    echo "FAIL $stem"; status=1
    (cd "$CACHE/archify" && node bin/archify.mjs validate "$type" "$f" 2>&1 | grep -v '^\[' | head -20) || true
  fi
done
exit $status
