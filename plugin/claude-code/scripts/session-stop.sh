#!/usr/bin/env bash
# drymem — Claude Code Stop hook
# Fires when the main agent finishes a turn. Runs autosave in the background.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DRYMEM_DIR="$(cd "$SCRIPTS_DIR/../../.." && pwd)"

INPUT=$(cat)

CWD=$(echo "$INPUT" | /usr/bin/node -e \
  "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
   process.stdout.write(d.cwd||'')" 2>/dev/null <<< "$INPUT" || echo "")

SESSION_ID=$(echo "$INPUT" | /usr/bin/node -e \
  "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
   process.stdout.write(d.session_id||'')" 2>/dev/null <<< "$INPUT" || echo "")

if [ -z "$CWD" ] || [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Construct transcript path: CWD with all '/' replaced by '-'
PROJECT_SLUG=$(echo "$CWD" | tr '/' '-')
TRANSCRIPT="$HOME/.claude/projects/${PROJECT_SLUG}/${SESSION_ID}.jsonl"

if [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

# Run autosave in the background so it never blocks Claude Code
/usr/bin/node "$SCRIPTS_DIR/autosave.mjs" "$CWD" "$TRANSCRIPT" "$SESSION_ID" &

exit 0
