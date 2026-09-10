#!/usr/bin/env bash
# drymem — Claude Code Stop hook.
# Autosave runs only if the agent did not already call mem_finalize_session.
# The payload is forwarded untouched: it carries transcript_path and
# last_assistant_message, so nothing needs reconstructing here.
set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export DRYMEM_DIR="$(cd "$SCRIPTS_DIR/../../.." && pwd)"

# Background it so a slow extraction never blocks the session ending.
uv --directory "$DRYMEM_DIR/apps/server" run python "$SCRIPTS_DIR/autosave.py" <<< "$(cat)" &

exit 0
