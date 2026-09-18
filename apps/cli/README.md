# drymem

Shared long-term memory for AI coding agents.

Your agent writes down what it worked out. The next session — yours or a
teammate's — starts already knowing it. One memory per project, shared by the
people working on it, not one per laptop.

```sh
npx drymem@latest setup
```

Run it inside a repository. It signs this machine in through your browser,
installs the session hooks, registers the MCP server, and pulls the skills the
project uses. Once per repository, per machine. Nothing is installed globally.

## You need a server to point at

drymem is a client. The memory lives on a server your team runs — one
`docker compose up` on a laptop or a VPS, with your own Postgres and Neo4j, or
managed ones. Nothing leaves your network unless you point it at a hosted model.

```sh
npx drymem@latest setup --server https://drymem.your-company.com
```

If your team already runs one, that address is all you need. If nobody does
yet, the self-hosting guide walks through it, including what to install on
macOS, Linux, Windows and a server.

## What you get

| | |
|---|---|
| **Memory, without asking** | In Claude Code, session hooks save what a session worked out and hand the next one its context. |
| **Answers, not a search box** | `npx drymem ask "why is the retry backoff 4s?"` answers from what the team actually wrote, with the memories it used. |
| **Skills that travel** | A skill published once is on every teammate's machine at their next session. No git, no copy-paste. |
| **Scoped to a project** | Memories belong to a project and the people in it. Nothing crosses organisations. |

Run `npx drymem` for the full command list.

## Which agents

Claude Code, OpenCode, Codex and Cursor. Skills are installed for all four.

Memory is automatic in Claude Code only — it is the one with session hooks, and
`setup` writes them. The other three reach the same memory through the MCP
server, which you register in that agent's own configuration as a stdio server
running `npx drymem mcp`.

## Licence

[Apache 2.0](LICENSE).

Seventeen of the skills bundled here are forked from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT licensed,
Copyright (c) 2026 Matt Pocock. They keep that licence — see
`skills/LICENSE` and `skills/ATTRIBUTION.md` in this package.
