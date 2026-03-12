#!/usr/bin/env bash
# drymem — Claude Code SessionStart (compact) hook
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DRYMEM_DIR="$(cd "$SCRIPTS_DIR/../../.." && pwd)"

INPUT=$(cat)
CWD=$(echo "$INPUT" | /usr/bin/node -e \
  "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
   process.stdout.write(d.cwd||'')" 2>/dev/null <<< "$INPUT" || echo "")

PROJECT="${CWD:-$(pwd)}"

CONTEXT=$(/usr/bin/node "$SCRIPTS_DIR/query.mjs" "$PROJECT" context 2>/dev/null || echo "")

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
