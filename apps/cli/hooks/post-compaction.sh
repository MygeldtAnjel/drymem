#!/usr/bin/env bash
# drymem — Claude Code SessionStart (compact) hook
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DRYMEM_DIR="$(cd "$SCRIPTS_DIR/../../.." && pwd)"

INPUT=$(cat)
CWD=$(echo "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null || echo "")

PROJECT="${CWD:-$(pwd)}"

CONTEXT=$(uv --directory "$DRYMEM_DIR/apps/server" run python "$SCRIPTS_DIR/query.py" "$PROJECT" context 2>/dev/null || echo "")

cat << 'PROTOCOL'
<drymem-post-compaction>
IMPORTANT: Your context was just compacted. Follow these steps before continuing:

1. Call mem_finalize_session to save a summary of what was accomplished before compaction.
2. Call mem_context to reload recent project memory.
3. Only then resume the user's task.
</drymem-post-compaction>
PROTOCOL

if [ -n "$CONTEXT" ]; then
  echo ""
  echo "<drymem-context project=\"$PROJECT\">"
  echo "$CONTEXT"
  echo "</drymem-context>"
fi
