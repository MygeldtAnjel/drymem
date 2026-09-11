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
| `mem_update` | Add to a topic, or replace it |
| `mem_delete` | Delete an episode by UUID |

A saved memory carries a **type** — `decision`, `architecture`, `bugfix`,
`discovery`, `convention` or `note` — and a body under five headings: *Summary*,
*Why*, *Where*, *Key details*, *Learned*. Both are conventions, not requirements:
an unknown type becomes `note` and an unstructured body still saves and still
reads. The server serves the current shape at `GET /v1/memories/schema`.

---

## How it is put together

Three apps, one database, one door.

| | | |
|---|---|---|
| `apps/web` | React + Tailwind + shadcn/ui | What people look at. Served by the API. |
| `apps/api` | Express + TypeScript + Drizzle | **Port 8080, the only public one.** Identity, people, projects, the skills registry, billing, audit. Serves the web app. |
| `apps/server` | FastAPI + Python + Graphiti | **Port 8090, never published.** Memories, the knowledge graph, extraction, the scrubber, discovery and distillation. |

A browser and the CLI only ever talk to `apps/api`. It resolves who you are and
passes a signed, ninety-second assertion to the engine, which verifies it and
trusts nothing else — so identity lives in exactly one codebase.

Alembic, in `apps/server/migrations`, is the single schema authority for the
database both use. `make migrate` applies it.

```bash
make up        # everything, in Docker
make dev       # engine and API with reload, databases in Docker
make test      # every suite
```

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
├── apps/
│   ├── server/            Python · uv · the MCP server today, FastAPI from step 2A
│   │   └── drymem_server/     server.py (5 tools) · graph.py (Graphiti client)
│   └── cli/               the `drymem` npm package from step 2A
│       └── hooks/             session-start · post-compaction · session-stop · subagent-stop
├── packages/
│   └── skills/            base agent skill set, bundled into the CLI
├── deploy/                docker-compose · Caddyfile                      (step 4)
├── docs/                  architecture.md · specs/
└── PLAN.md                what we are building and in what order
```

See [PLAN.md](PLAN.md) for the roadmap and [docs/architecture.md](docs/architecture.md)
for how the pieces fit.
