#!/usr/bin/env bash
# drymem v2 setup script
set -euo pipefail

DRYMEM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$DRYMEM_DIR/plugin/claude-code/scripts"
TARGET_DIR="$(pwd)"

echo "drymem v2 setup"
echo "==============="
echo ""

# ── 1. Install Python dependencies ──────────────────────────────────────────
echo "Installing Python dependencies with uv..."
if ! command -v uv &>/dev/null; then
  echo "ERROR: uv is not installed. Install it first: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

cd "$DRYMEM_DIR"
uv sync
echo "  Dependencies installed."
echo ""

# ── 2. Docker check ────────────────────────────────────────────────────────
echo "Checking Neo4j..."
if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  if ! docker ps --format '{{.Names}}' | grep -q drymem-neo4j; then
    echo "  Starting Neo4j container..."
    docker compose -f "$DRYMEM_DIR/docker-compose.yml" up -d
    echo "  Neo4j started (bolt://localhost:7687, UI at http://localhost:7474)"
  else
    echo "  Neo4j already running."
  fi
else
  echo "  WARNING: docker/docker-compose not found. Start Neo4j manually."
fi
echo ""

# ── 3. Scope & integration selection ───────────────────────────────────────
echo "Select scope:"
echo "  1) Global  — works in ALL your projects (installs to ~/.claude/)"
echo "  2) Project — works only in the current directory (installs to ./.claude/)"
echo ""
read -rp "Scope [1/2]: " SCOPE

case "$SCOPE" in
  1) CLAUDE_DIR="$HOME/.claude" ;;
  2) CLAUDE_DIR="$TARGET_DIR/.claude" ;;
  *) echo "Invalid choice."; exit 1 ;;
esac

echo ""
echo "Select integration:"
echo "  1) Claude Code (hooks — automatic context injection)"
echo "  2) Roo Code    (shows manual setup instructions)"
echo "  3) Both"
echo ""
read -rp "Integration [1/2/3]: " CHOICE

install_claude_hooks() {
  mkdir -p "$CLAUDE_DIR/commands"

  local SETTINGS_FILE="$CLAUDE_DIR/settings.json"
  local TMP
  TMP=$(mktemp)

  cat > "$TMP" << HOOKS
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "bash $SCRIPTS_DIR/session-start.sh",
            "timeout": 10000
          }
        ]
      },
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "bash $SCRIPTS_DIR/post-compaction.sh",
            "timeout": 10000
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash $SCRIPTS_DIR/session-stop.sh",
            "timeout": 5000,
            "async": true
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash $SCRIPTS_DIR/subagent-stop.sh",
            "timeout": 10000,
            "async": true
          }
        ]
      }
    ]
  }
}
HOOKS

  if [ -f "$SETTINGS_FILE" ]; then
    python3 - << PYEOF
import json
with open('$SETTINGS_FILE') as f:
    settings = json.load(f)
with open('$TMP') as f:
    hooks = json.load(f)
settings['hooks'] = hooks['hooks']
with open('$SETTINGS_FILE', 'w') as f:
    json.dump(settings, f, indent=2)
    f.write('\n')
PYEOF
    echo "  Merged hooks     → $SETTINGS_FILE"
  else
    mv "$TMP" "$SETTINGS_FILE"
    echo "  Installed hooks  → $SETTINGS_FILE"
  fi

  rm -f "$TMP" "$CLAUDE_DIR/hooks.json"

  cp "$DRYMEM_DIR/plugin/claude-code/SKILL.md" "$CLAUDE_DIR/commands/drymem-memory.md"
  echo "  Installed skill  → $CLAUDE_DIR/commands/drymem-memory.md"
}

install_mcp_config() {
  # Claude Code reads MCP servers from ~/.claude.json — use `claude mcp add` to register correctly.
  local SCOPE_FLAG=""
  if [ "$SCOPE" = "2" ]; then
    SCOPE_FLAG="-s project"
  else
    SCOPE_FLAG="-s user"
  fi

  # For project scope, claude mcp add writes to cwd/.mcp.json — must be in the target project
  if [ "$SCOPE" = "2" ]; then
    cd "$TARGET_DIR"
  fi

  # Remove existing drymem in this scope before re-adding (handles v1→v2 upgrades)
  claude mcp remove drymem $SCOPE_FLAG 2>/dev/null || true

  claude mcp add $SCOPE_FLAG drymem \
      --env NEO4J_URI=bolt://localhost:7687 \
      --env NEO4J_USER=neo4j \
      --env NEO4J_PASSWORD=drymem_pass \
      --env LOCAL_LLM_URL=http://localhost:11434/v1 \
      --env LOCAL_LLM_MODEL=qwen3.6:35b-a3b \
      --env EMBEDDING_MODEL=nomic-embed-text \
      --env EMBEDDING_DIM=768 \
      -- uv --directory "$DRYMEM_DIR" run python -m src.server
  echo "  Registered MCP   → drymem (via claude mcp add)"
}

setup_claude_code() {
  echo ""
  echo "Setting up Claude Code..."
  install_claude_hooks
  install_mcp_config
  echo ""
  echo "Done. Hooks fire automatically on session start and after compaction."
}

setup_roo_code() {
  echo ""
  echo "Roo Code setup"
  echo "--------------"
  echo ""

  if [ "$SCOPE" = "2" ]; then
    local ROO_DIR="$TARGET_DIR/.roo"
    local MCP_FILE="$ROO_DIR/mcp.json"
    mkdir -p "$ROO_DIR"

    if [ -f "$MCP_FILE" ]; then
      echo "  Overwriting existing $MCP_FILE with v2 config..."
    fi
      cat > "$MCP_FILE" << MCP
{
  "mcpServers": {
    "drymem": {
      "command": "uv",
      "args": [
        "--directory", "$DRYMEM_DIR",
        "run", "python", "-m", "src.server"
      ],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "drymem_pass",
        "LOCAL_LLM_URL": "http://localhost:11434/v1",
        "LOCAL_LLM_MODEL": "qwen3.6:35b-a3b",
        "EMBEDDING_MODEL": "nomic-embed-text",
        "EMBEDDING_DIM": "768"
      },
      "alwaysAllow": [
        "mem_context",
        "mem_search",
        "mem_delete",
        "mem_finalize_session",
        "mem_update"
      ]
    }
  }
}
MCP
      echo "  Installed MCP    → $MCP_FILE"
  else
    echo "  For global Roo Code MCP config, add the server via:"
    echo "  Roo Code → MCP Servers → Edit Global MCP (opens mcp_settings.json)"
    echo ""
    echo "  Paste this into the mcpServers block:"
    echo ""
    cat "$DRYMEM_DIR/plugin/roo-code/mcp-config.json"
  fi

  echo ""
  echo "  Memory protocol — add to Roo Code Custom Instructions (global)"
  echo "  or create .roorules in your project root."
  echo "  Content to use: $DRYMEM_DIR/plugin/roo-code/MEMORY_PROTOCOL.md"
}

case "$CHOICE" in
  1) setup_claude_code ;;
  2) setup_roo_code ;;
  3) setup_claude_code; setup_roo_code ;;
  *) echo "Invalid choice."; exit 1 ;;
esac

echo ""
echo "Done. Make sure Neo4j is running and your local LLM is serving at \$LOCAL_LLM_URL."
