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

| Tool | Purpose |
|---|---|
| `mem_context` | Load recent project memory (last 5 session summaries) |
| `mem_search` | Full-text search memory by keyword |
| `mem_finalize_session` | Save a structured session summary |
| `mem_delete` | Soft-delete an outdated memory |

---

## Installation

### 1. Install dependencies

```bash
npm install
npm rebuild better-sqlite3 --build-from-source
```

### 2. Run migrations

```bash
node_modules/.bin/tsx src/migrate.ts
```

### 3. Run setup

```bash
bash setup.sh
```

This installs hooks for Claude Code and/or shows instructions for Roo Code.

---

## Claude Code Integration

Claude Code supports **lifecycle hooks** — shell scripts that fire automatically on session events. drymem uses this to inject memory without any manual prompting.

### What happens automatically

| Event | Hook | What drymem does |
|---|---|---|
| Session starts | `session-start.sh` | Injects memory protocol + loads project context |
| Context compacted | `post-compaction.sh` | Re-injects context, prompts agent to save before continuing |
| Subagent finishes | `subagent-stop.sh` | Detects `## Key Learnings` sections, surfaces them for manual save |

### Setup

Run `bash setup.sh` and choose option 1. It generates `.claude/hooks.json` with the correct absolute paths and copies the memory protocol to `.claude/commands/drymem-memory.md`.

Then add drymem to your `.mcp.json`:

```json
{
  "mcpServers": {
    "drymem": {
      "command": "/usr/bin/node",
      "args": [
        "/path/to/drymem/node_modules/tsx/dist/cli.mjs",
        "/path/to/drymem/src/delivery/mcp/server.ts"
      ],
      "env": {
        "DRYMEM_DB_PATH": "/path/to/drymem/drymem.sqlite"
      }
    }
  }
}
```

> **Important:** use `/usr/bin/node`, not an NVM version. `better-sqlite3` is a native addon compiled against the system Node — version mismatches crash the server.

---

## Roo Code Integration

Roo Code does not have a hook system, so the setup is manual. The memory protocol is injected via custom instructions, and the agent must follow them.

### 1. Add MCP server

**Per-project** — create `.roo/mcp.json` in your project root (committed to git, only applies to that project):
```bash
bash /path/to/drymem/setup.sh
# choose: 2 (Project) → 2 (Roo Code)
```

**Global** — open Roo Code → MCP Servers → Edit Global MCP (`mcp_settings.json`) and paste the content from `plugin/roo-code/mcp-config.json`.

### 2. Add memory protocol

Option A — **Global** (all projects): Roo Code Settings → Custom Instructions → paste content from `plugin/roo-code/MEMORY_PROTOCOL.md`.

Option B — **Per-project**: Create `.roorules` in your project root with the instructions block.

### Ollama models

Ollama model quality varies. If the model ignores `mem_context` at session start, prefix your first message:

```
Before answering, load memory context for this project using mem_context.
```

Short, imperative instructions work better than long explanations with Ollama models.

---

## Memory Protocol (what the agent is told to do)

For both tools the protocol is the same:

1. **Session start** — silently call `mem_context` to load recent project history
2. **Before any task** — silently call `mem_search` with 1-2 short keywords
3. **During work** — use the context found, do not announce it
4. **Saving** — only call `mem_finalize_session` when the user explicitly asks
5. **After compaction** — call `mem_context` to recover context, then continue

### Search keyword rules

The FTS5 search engine is strict about input. Always use:
- Short single keywords: `"auth"` not `"authentication system"`
- No hyphens: `"sqlite"` not `"better-sqlite3"`
- No phrases: `"test"` not `"test structure testing"`

---

## Tech Stack

- **Runtime:** Node.js + TypeScript (via tsx)
- **Database:** SQLite (better-sqlite3) with FTS5 full-text search
- **Protocol:** MCP (Model Context Protocol) over stdio
- **Compatible with:** Claude Code (hooks), Roo Code (custom instructions), any MCP-capable agent

---

## Project Structure

```
drymem/
├── src/
│   ├── delivery/mcp/server.ts       # MCP server (4 tools)
│   ├── core/use-cases/              # Business logic
│   └── infrastructure/database/     # SQLite + FTS5
├── plugin/
│   ├── claude-code/
│   │   ├── hooks.json.template      # Hook definitions (setup.sh fills paths)
│   │   ├── SKILL.md                 # Memory protocol (copied to .claude/commands/)
│   │   └── scripts/
│   │       ├── query.mjs            # SQLite query helper for hooks
│   │       ├── session-start.sh     # SessionStart hook
│   │       ├── post-compaction.sh   # Post-compaction hook
│   │       └── subagent-stop.sh     # SubagentStop hook
│   └── roo-code/
│       ├── MEMORY_PROTOCOL.md       # Instructions to paste into Roo Code
│       └── mcp-config.json          # MCP server config snippet
├── test/
│   └── mcp-functional-tests.ts      # End-to-end functional tests
└── setup.sh                         # Install script
```
