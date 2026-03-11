# drymem

**Persistent memory for AI coding assistants.**

drymem is a local MCP server that gives agents like Roo Code and Claude Code a long-term memory across sessions. Instead of starting every conversation from zero, the agent loads what was done before, applies that knowledge, and saves a structured summary at the end.

---

## The Problem

Every new AI coding session is amnesiac. The agent has no idea:
- What you already tried and rejected
- What architectural decisions are in place
- What caused that bug you fixed last week

You end up re-explaining context every time. drymem fixes this.

---

## How It Works

### At the start of every session
The agent calls `mem_context` — gets the last 5 session summaries for the current project. It now knows the history before you say a word.

### During the session (optional)
You can ask the agent to search for a specific past decision: *"search your memory for X"*. The agent will call `mem_search` — but it won't do this on its own.

### At the end of the session
The agent calls `mem_finalize_session` — saves a structured markdown summary: what the problem was, what was done, which files changed, and key learnings.

---

## Architecture

```
IDE (Roo Code / Claude Code)
        │
        ▼
  MCP Protocol (stdio)
        │
        ▼
  drymem server (TypeScript / Node.js)
        │
        ▼
  SQLite + FTS5 (drymem.sqlite)
```

- **Transport:** stdio MCP — zero network overhead, works locally
- **Storage:** SQLite with FTS5 full-text search + LIKE fallback
- **Scope:** per-project (scoped by `project_path`)
- **Soft deletes:** nothing is hard-deleted

---

## MCP Tools

| Tool | When to use |
|---|---|
| `mem_context` | Start of session — loads recent project history |
| `mem_search` | On demand — explicitly ask the agent to search memory for a keyword |
| `mem_finalize_session` | End of session — save a structured summary |
| `mem_delete` | Cleanup — soft-delete a wrong or outdated memory |

---

## Session Prompt

Add this to the start of any agent conversation:

```
Before starting: call mem_context (drymem) to load the project history.

[your task here]

When done: call mem_finalize_session (drymem) to save a summary of what we did.
```

---

## Setup

### 1. Install dependencies

```bash
npm install
npm rebuild better-sqlite3 --build-from-source
```

### 2. Run migrations

```bash
node --import tsx/esm src/migrate.ts
```

### 3. MCP config (Roo Code / Claude Code)

```json
{
  "mcpServers": {
    "drymem": {
      "command": "/usr/bin/node",
      "args": [
        "/path/to/drymem/node_modules/tsx/dist/cli.mjs",
        "/path/to/drymem/src/delivery/mcp/server.ts"
      ],
      "cwd": "/path/to/drymem",
      "timeout": 120,
      "alwaysAllow": [
        "mem_context",
        "mem_search",
        "mem_delete",
        "mem_finalize_session"
      ]
    }
  }
}
```

> **Important:** use the system `node` binary (`/usr/bin/node`), not an NVM version. `better-sqlite3` is a native addon compiled against the system Node — version mismatches will crash the server.

---

## Tech Stack

- **Runtime:** Node.js + TypeScript (via tsx)
- **Database:** SQLite (better-sqlite3) with FTS5 full-text search
- **Protocol:** MCP (Model Context Protocol) over stdio
- **Compatible with:** Roo Code, Claude Code, any MCP-capable agent
