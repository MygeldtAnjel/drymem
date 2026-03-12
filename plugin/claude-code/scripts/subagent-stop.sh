#!/usr/bin/env bash
# drymem — Claude Code SubagentStop hook
set -euo pipefail

INPUT=$(cat)

STDOUT=$(echo "$INPUT" | /usr/bin/node -e \
  "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
   process.stdout.write(d.stdout||'')" 2>/dev/null <<< "$INPUT" || echo "")

if echo "$STDOUT" | grep -q "## Key Learnings"; then
  echo "[drymem] Subagent produced Key Learnings. Consider calling mem_finalize_session to persist them." >&2
fi

exit 0
