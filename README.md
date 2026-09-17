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

drymem is three services and a database pair, all started together. You do not
install the Python or the Node app by hand; `docker compose` builds both.

### Prerequisites

- Docker with `docker compose`
- [Ollama](https://ollama.ai/) with a chat model and an embedding model pulled,
  if you want extraction to run on your own machine (the default)
- Node 20+, only to run the `drymem` CLI from a repository

### 1. Configure

```bash
cp .env.example .env
openssl rand -hex 32   # put this in SERVICE_SECRET
```

`SERVICE_SECRET` is the only value with no default. It signs the short-lived
principal the API mints for each call into the memory engine — the engine
authenticates nobody and trusts that signature alone, so generate one per
install and keep it out of git.

### 2. Start it

```bash
docker compose up -d
```

Four containers: Postgres, Neo4j, the memory engine on 8090, and the API with
the web app on 8080. Only 8080 is meant for people. Open
<http://127.0.0.1:8080> and create the first account — whoever signs up first
owns the organisation, and everyone after them arrives by invitation.

The catalogue is not empty on day one: signing up publishes the bundled base
skills into it. They are published, not enabled — a project lead still chooses
what runs on the team's machines.

### 3. Connect a repository

```bash
cd ~/your-project
npx drymem setup
```

That signs the machine in through the browser, writes `.drymem/`, installs the
session hooks, and registers the MCP server. From then on `npx drymem skills
pull` runs on session start, so a `git pull` is all a teammate needs.

### Deploying it somewhere

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The override moves everything onto a private bridge network and publishes only
the API — the development compose uses host networking so the engine can reach
an Ollama on the host's loopback, which is the wrong shape on a server. Set
`PUBLIC_URL` to the address people actually type (invitation and reset links
are built from it), `LOCAL_LLM_URL` to a model that network can reach, and put
TLS in front of it with `COOKIE_SECURE=true`.

---

## Claude Code Integration

`npx drymem setup` writes both halves of this into the repository's Claude Code
settings. There is nothing to copy by hand.

### Lifecycle hooks

Each one runs `npx drymem hook <event>`, so they work on any machine that can
run the CLI — no paths into a clone.

| Event | What drymem does |
|---|---|
| Session starts | Pulls the project's skills, then injects the memory protocol and recent context |
| Context compacted | Re-injects context and asks the agent to save before continuing |
| Session ends | Offers to save a summary, if the project's capture mode asks for one |
| Subagent finishes | Surfaces a Key Learnings section for saving |

What gets saved is the project's choice, not ours: capture mode is `automatic`,
`ask` or `manual`, set per project in Settings. On `manual` nothing is written
unless somebody runs `drymem save-session`.

### MCP server

`setup` registers it in `.mcp.json` as `npx drymem mcp`, giving the agent
`mem_search`, `mem_context`, `mem_finalize_session`, `mem_update` and
`mem_delete` over stdio.

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
```

See [docs/architecture.md](docs/architecture.md)
for how the pieces fit.
