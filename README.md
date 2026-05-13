# drymem v2

**Persistent memory for AI coding assistants — powered by a knowledge graph.**

drymem is a local MCP server that gives agents like Claude Code and Roo Code long-term memory across sessions. Instead of starting every conversation from zero, the agent loads past context, applies it, and saves structured summaries that get decomposed into a knowledge graph.

---

## How It Works

```
IDE (Claude Code / Roo Code)
        │
        ▼
  MCP Protocol (stdio)
        │
        ▼
  drymem server (Python / FastMCP)
        │
        ▼
  Graphiti (Knowledge Graph Engine)
        │
        ▼
  Neo4j (Graph Database)
        │
  Local LLM (entity/relation extraction)
```

- **Transport:** stdio MCP — zero network overhead, works locally
- **Storage:** Neo4j graph database via Graphiti — entities, relationships, and episodes
- **LLM Extraction:** Local OpenAI-compatible LLM via Ollama (e.g. Qwen 35B) — no paid API keys
- **Scope:** per-project isolation via `group_id` derived from `project_path`

---

## MCP Tools

| Tool | Purpose |
|---|---|
| `mem_context` | Load recent episodes for a project |
| `mem_search` | Search the knowledge graph by keyword |
| `mem_finalize_session` | Save a session summary — Graphiti extracts entities & relationships |
| `mem_delete` | Delete an episode by UUID |

---

## Installation

### Prerequisites

- Python 3.10+
- [uv](https://docs.astral.sh/uv/) (package manager)
- Docker (for Neo4j)
- [Ollama](https://ollama.ai/) with a chat model and an embedding model pulled

### 1. Start Neo4j

```bash
docker compose up -d
```

This starts Neo4j Community with APOC plugins. Default credentials: `neo4j` / `drymem_pass`.

### 2. Configure environment

Copy `.env.example` or create `.env`:

```bash
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=drymem_pass
LOCAL_LLM_URL=http://localhost:11434/v1
LOCAL_LLM_MODEL=qwen3.6:35b-a3b
EMBEDDING_MODEL=nomic-embed-text
EMBEDDING_DIM=768
```

### 3. Install dependencies & run setup

```bash
uv sync
bash setup.sh
```

The setup script installs hooks for Claude Code and/or shows instructions for Roo Code.

---

## Claude Code Integration

Claude Code supports **lifecycle hooks** that fire automatically on session events.

| Event | Hook | What drymem does |
|---|---|---|
| Session starts | `session-start.sh` | Injects memory protocol + loads project context |
| Context compacted | `post-compaction.sh` | Re-injects context, prompts agent to save before continuing |
| Subagent finishes | `subagent-stop.sh` | Detects Key Learnings sections, surfaces them for save |

### MCP config (`.mcp.json`)

```json
{
  "mcpServers": {
    "drymem": {
      "command": "uv",
      "args": ["--directory", "/path/to/drymem", "run", "python", "-m", "src.server"],
      "env": {
        "NEO4J_URI": "bolt://localhost:7687",
        "NEO4J_USER": "neo4j",
        "NEO4J_PASSWORD": "drymem_pass",
        "LOCAL_LLM_URL": "http://localhost:11434/v1",
        "LOCAL_LLM_MODEL": "qwen3.6:35b-a3b",
        "EMBEDDING_MODEL": "nomic-embed-text",
        "EMBEDDING_DIM": "768"
      }
    }
  }
}
```

---

## Roo Code Integration

Roo Code does not have hooks, so setup is manual:

1. Add the MCP server via Roo Code settings or `.roo/mcp.json`
2. Paste the memory protocol from `plugin/roo-code/MEMORY_PROTOCOL.md` into Custom Instructions

---

## Tech Stack

- **Runtime:** Python 3.10+ via uv
- **Graph Engine:** Graphiti (knowledge graph with LLM-powered entity extraction)
- **Database:** Neo4j 5 Community
- **LLM:** Ollama (OpenAI-compatible API on port 11434)
- **Protocol:** MCP (Model Context Protocol) over stdio

---

## Project Structure

```
drymem/
├── src/
│   ├── server.py              # FastMCP server (4 tools)
│   └── graph.py               # Graphiti client singleton
├── plugin/
│   ├── claude-code/
│   │   ├── SKILL.md           # Memory protocol (copied to .claude/commands/)
│   │   └── scripts/
│   │       ├── query.py       # Neo4j query helper for hooks
│   │       ├── session-start.sh
│   │       ├── post-compaction.sh
│   │       ├── session-stop.sh
│   │       └── subagent-stop.sh
│   └── roo-code/
│       ├── MEMORY_PROTOCOL.md
│       └── mcp-config.json
├── docker-compose.yml         # Neo4j container
├── pyproject.toml             # Python project config
└── setup.sh                   # Installation script
```
