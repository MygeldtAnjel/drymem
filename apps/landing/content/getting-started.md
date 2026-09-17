# Getting started

drymem gives your team one memory their coding agents read and write. Your agent
writes down what it worked out; the next session — yours or a teammate's —
starts already knowing it.

You need Node 20 or newer, a coding agent, and an invitation to a drymem server.

## Connect a repository

In a project you work in:

```bash
npx drymem@latest setup
```

That signs this machine in through your browser, installs the session hooks,
registers the MCP server, and pulls any skills the project uses. Once per
repository, per machine. Nothing is installed globally.

Check it worked:

```bash
npx drymem whoami
```

```
project: github.com/acme/payments
server:  https://drymem.acme.com
health:  ok (postgres true, neo4j true)
```

If the project line says `local/…`, this directory has no git remote. drymem
identifies a project by its remote, so that every clone resolves to the same
memory; a directory without one gets a private, machine-local key instead.

**Restart your agent afterwards.** Hooks are read when it starts.

## What happens without you

Once connected, nothing needs remembering:

- **At session start** your agent is given the project's recent memories, and
  the skills the project uses are installed.
- **While you work** it searches memory before starting a task.
- **When you finish** it writes down what it worked out — a decision, a bugfix,
  a convention — and saves it privately.

Whether that last one happens is a per-project setting. See
[Automatic, ask, or manual](#automatic-ask-or-manual).

## Your first memory

Do a piece of real work and let the session end. Then:

```bash
npx drymem context 5
```

You will see what your agent wrote. It is private to you until you share it.

## Automatic, ask, or manual

A project lead chooses what happens at the end of a session, under **Settings**
in the console:

| Mode | What the agent does |
|---|---|
| Automatic | Writes a private summary when it finishes. Nobody sees it until you share it. |
| Ask first | Proposes a summary and waits for you to confirm, edit or discard it. |
| Manual only | Saves nothing. You run `drymem save-session` when you want to. |

The setting applies to the project, not to you, so a team decides this once.

## Where next

- [The console](#/docs/console) — reading, searching and sharing in the browser.
- [Command reference](#/docs/cli) — every command, and what it is for.
- [Skills](#/docs/skills) — turning what you keep re-explaining into something
  every agent installs.
