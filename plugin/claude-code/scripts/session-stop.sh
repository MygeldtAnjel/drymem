#!/usr/bin/env bash
# drymem — Claude Code Stop hook
# Runs autosave in background after every agent turn.
# If the agent already called mem_finalize_session, autosave skips.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DRYMEM_DIR="$(cd "$SCRIPTS_DIR/../../.." && pwd)"

INPUT=$(cat)

CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")
SESSION_ID=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null || echo "")

if [ -z "$CWD" ] || [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Construct transcript path
PROJECT_SLUG=$(echo "$CWD" | tr '/' '-')
TRANSCRIPT="$HOME/.claude/projects/${PROJECT_SLUG}/${SESSION_ID}.jsonl"

if [ ! -f "$TRANSCRIPT" ]; then
  exit 0
fi

# Run autosave in background so it never blocks Claude Code
uv --directory "$DRYMEM_DIR" run python "$SCRIPTS_DIR/autosave.py" "$CWD" "$TRANSCRIPT" "$SESSION_ID" &

exit 0
