# Skills

A skill is a folder with a `SKILL.md` in it — instructions your agent reads when
the work calls for them. drymem's job is deciding which ones a project runs, and
getting them onto every machine without anybody remembering a command.

## Where they come from

**Distilled from your own memory.** drymem watches for subjects a project keeps
re-learning with nothing written for them, and drafts a skill out of those
memories. You read the draft before anything is published.

**Written by hand.** A team already has conventions; `skills publish` puts one
in the catalogue.

**Imported.** `skills import owner/repo@skill` brings in a skill from outside.
Org admins only — an imported skill runs on every machine on whichever projects
enable it, which is an organisation's decision rather than a project's.

## How one reaches a machine

```diagram:04-skill-distribution How a skill reaches every teammate's agent
```

Publishing puts a skill in the **organisation's catalogue**. Enabling it turns
it on **for one project** and pins that project to a version, so another project
is never changed by your decision.

From there nobody runs anything. Each teammate's agent asks for the project's
enabled skills when a session starts, with that machine's own token, and writes
them where that agent reads them.

## Which agents

| Agent | Skills land in |
|---|---|
| Claude Code | `.claude/skills/` |
| OpenCode | `.opencode/skill/` |
| Codex | `.codex/skills/` |
| Cursor | `.cursor/rules/` (one `.mdc` rule per skill) |

Only agents actually present on that machine get anything written. drymem never
creates a directory for an agent you do not use.

Skills reach all four. Memory does not: it is automatic in Claude Code alone,
because that is the one with session hooks. In the other three you register the
memory tools yourself, as a stdio MCP server running `npx drymem mcp`.

## They are not committed

Installed skills are generated files, and they are gitignored. `git status` stays
clean.

This surprises people, so: the console can add a skill, and a browser has no
checkout. Putting skills in git would mean the server holding write access to
every project's repository — and a file in git would disagree with the catalogue
the moment anyone clicked anything. Fetching is simpler and it is what the
machine can already do.

## Removing one

Turn it off for the project and it is deleted from disk at each teammate's next
session. Only skills drymem installed are ever touched: each one carries a
marker file, and a skill somebody wrote by hand in the same directory is left
exactly where it is.

## Before anything is published

Every skill is scanned first. A skill runs on every teammate's agent, so:

- A credential in the content is **refused outright** — nothing is stored.
- Anything else the scanner flags is **held until an admin approves it**.
- Publishing the same bytes twice changes nothing and adds no version.

## The ones you start with

drymem ships with a starting set so a new project is not an empty catalogue —
TDD, code review, domain modelling, turning a conversation into a spec, and a
dozen more. Seventeen of them are forked from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT licensed,
Copyright (c) 2026 Matt Pocock, and they keep that licence. We changed four of
them to drop his issue-tracker coupling and to hand off through drymem instead
of a file in `/tmp`; the rest are his words, unedited.

They are a starting point, not a house style. Turn off the ones you do not
want.
