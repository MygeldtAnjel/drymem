<div align="center">

# drymem

**Shared memory and skills for coding agents.**

Your agents keep re-learning what your team already decided. drymem gives them
one memory they all read and write — and turns what you keep re-explaining into
a skill every agent installs.

[Docs](apps/landing/content/getting-started.md) ·
[Self-hosting](apps/landing/content/self-hosting.md) ·
[Commands](apps/landing/content/cli.md)

</div>

---

## The problem

“We settled this in March.” Your agent doesn't know that. It reads the code, not
the argument behind it — so it proposes the thing you ruled out, and somebody
explains the reasoning for the fourth time.

That reasoning isn't written anywhere an agent can reach. It's in a thread, a
call, and three people's heads.

## Quick start

Run a server:

```bash
git clone https://github.com/MygeldtAnjel/drymem.git
cd drymem
./scripts/install.sh
```

It asks who will use it, which model to call and which ports to take, writes the
config, and starts everything. Open it and create the first account — that one
owns the organisation.

Then, in a repository you work in:

```bash
npx drymem@latest setup
```

That signs the machine in through your browser, installs the session hooks,
registers the MCP server, and pulls the project's skills. Once per repository.

## What it does

**Remembers.** At the end of a session your agent writes down what it worked
out — a decision, a bugfix, a convention — and saves it privately. The next
session, yours or a teammate's, starts with the relevant ones already loaded.

**Answers.** Ask a question and get an answer built only from what the project's
memory contains, with a card for every memory it used. Nothing matches, it says
so rather than inventing one.

**Distils.** drymem watches for subjects the team keeps re-learning with nothing
written for them, drafts a skill out of your own memory, and — once a lead
approves it — installs it on every agent on the project.

## Works with

| Agent | Skills land in | Memory |
|---|---|---|
| Claude Code | `.claude/skills/` | Automatic, through session hooks |
| OpenCode | `.opencode/skill/` | Through MCP, registered by hand |
| Codex | `.codex/skills/` | Through MCP, registered by hand |
| Cursor | `.cursor/rules/` | Through MCP, registered by hand |

Skills are installed for every agent on the machine. Memory is automatic only in
Claude Code, which is the only one with session hooks — `setup` writes them, and
registers the MCP server in `.mcp.json`. The other three read their MCP
configuration from their own files, so add `npx drymem mcp` as a stdio server
there yourself; the memory tools are then the same.

Only agents actually present on a machine get anything written, and nothing is
written into a directory drymem did not create.

## How it is put together

```
your machine                     the server
────────────                     ──────────
agent ──hooks──┐
               ├── npx drymem ──► API ──► engine ──► Neo4j   memory text, entities
browser ───────┘                   │         │
                                   └─────────┴──► Postgres  who, when, which project
                                             └──► a model    extraction and answers
```

The API is the only published port. The engine is never exposed. Postgres holds
the index — who wrote what, when, and what it was rated; Neo4j holds the only
copy of each memory's text. Isolation is per organisation and per person, and is
tested against a real Neo4j rather than asserted.

## Privacy

**Your repository never leaves.** No source, no diffs, no transcripts. What
drymem stores is the short summary your agent writes about the work.

Everything passes a scrubber before it is stored: keys and tokens are redacted
and the redaction is recorded, and a private key block fails the save loudly —
a leaked key needs a human to know about it.

Run it against an Ollama on your own hardware and nothing leaves your network at
all. Point it at an API instead and those summaries — not your code — go to that
provider.

## Running it yourself

One `docker compose`: the API, the engine, Postgres, Neo4j, and a model you
point it at. Roughly 4 GB of RAM without a local model, more with one.

See [self-hosting](apps/landing/content/self-hosting.md) for backups,
provisioning an organisation, email and upgrades.

## Development

```bash
pnpm install
make db-up          # Postgres and Neo4j
make dev            # engine and API
make test           # every suite
```

The console is built, not committed. `pnpm --filter @drymem/web run build` puts
it where the API serves it from; `pnpm --filter @drymem/web run dev` is the one
you want while working on it.

| | |
|---|---|
| `apps/server` | The memory engine — Python, FastAPI, Graphiti |
| `apps/api` | Identity, projects, skills, audit — TypeScript, Express |
| `apps/web` | The console — React |
| `apps/cli` | `npx drymem` — the CLI, hooks and MCP server |
| `apps/landing` | The public site and its documentation |

Alembic owns the database schema; the TypeScript side reads it through Drizzle
but never migrates it.

## Contributing

Issues and pull requests are welcome. Run `make test` before opening one — it
covers the engine, the control plane, the CLI and the console.

## Licence

[Apache 2.0](LICENSE).

Seventeen of the skills drymem ships with are forked from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT licensed,
Copyright (c) 2026 Matt Pocock. They keep that licence, and what we changed and
why is written down in [packages/skills/ATTRIBUTION.md](packages/skills/ATTRIBUTION.md).
