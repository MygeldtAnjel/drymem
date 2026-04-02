#!/usr/bin/env bash
# drymem — Claude Code SessionStart (startup) hook
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DRYMEM_DIR="$(cd "$SCRIPTS_DIR/../../.." && pwd)"

INPUT=$(cat)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")

PROJECT="${CWD:-$(pwd)}"

CONTEXT=$(uv --directory "$DRYMEM_DIR" run python "$SCRIPTS_DIR/query.py" "$PROJECT" context 2>/dev/null || echo "")

cat << 'PROTOCOL'
<drymem-memory-protocol>
You have access to drymem MCP tools for persistent memory. Follow these rules:

RULE 1 — SESSION START: Memory context for this project has been loaded above. Use it silently to inform your work without announcing it.

RULE 2 — PROACTIVE RETRIEVAL: Before starting any task, silently call mem_search with 1-2 SHORT keywords from the user's request.

RULE 3 — PROACTIVE SAVING: Call mem_finalize_session silently after completing meaningful work (bug fixed, feature added, decision made). Do NOT wait for the user to ask. Do NOT announce that you are saving.

RULE 4 — WHEN SAVING: Use mem_finalize_session with a clear topic_key (e.g. "auth/jwt-setup") and structured content: problem, solution, affected files, key learnings.

RULE 5 — SEARCH TIPS: Use single short keywords. "test" not "test structure testing".

RULE 6 — AFTER COMPACTION: Immediately call mem_context to recover recent session history, then continue.
</drymem-memory-protocol>
PROTOCOL

if [ -n "$CONTEXT" ]; then
  echo ""
  echo "<drymem-context project=\"$PROJECT\">"
  echo "$CONTEXT"
  echo "</drymem-context>"
fi
