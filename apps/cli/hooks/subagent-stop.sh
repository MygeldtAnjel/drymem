#!/usr/bin/env bash
# drymem — Claude Code SubagentStop hook.
# Surfaces a subagent's findings so the main agent can persist them.
# Reads last_assistant_message; there is no `stdout` field on this event.
set -euo pipefail

INPUT=$(cat)

LAST=$(printf '%s' "$INPUT" | python3 -c "
import sys, json
try:
    print(json.load(sys.stdin).get('last_assistant_message') or '')
except Exception:
    pass
" 2>/dev/null || echo "")

if printf '%s' "$LAST" | grep -qiE '^#+ *(key learnings|learnings|findings)'; then
  echo "[drymem] Subagent reported findings. Persist them with mem_finalize_session." >&2
fi

exit 0
