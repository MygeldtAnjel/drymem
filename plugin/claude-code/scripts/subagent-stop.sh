#!/usr/bin/env bash
# drymem — Claude Code SubagentStop hook
set -euo pipefail

INPUT=$(cat)

STDOUT=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('stdout',''))" 2>/dev/null || echo "")

if echo "$STDOUT" | grep -q "## Key Learnings"; then
  echo "[drymem] Subagent produced Key Learnings. Consider calling mem_finalize_session to persist them." >&2
fi

exit 0
