# How a skill reaches a teammate's machine

Short answer: **it does not travel through git.** Git carries your code. Skills
come from the drymem server, fetched by each teammate's own machine with their
own token. Nothing needs write access to the repository.

```
  ADMIN (web UI or CLI)                 DRYMEM SERVER            TEAMMATE'S MACHINE
  ─────────────────────                 ─────────────            ──────────────────

  1  writes a memory in a repo  ──────▶  project created
                                         (they become its lead)

  2  invites a teammate         ──────▶  user created
     adds them to the project   ──────▶  membership

  3  Add skill  ──────────────────────▶  skill enabled
     (a click, or `drymem                for this project
      skills add <name>`)                        │
                                                 │
  4                                              │   `drymem setup`   ← once, per
                                                 │   installs the      repo, per
                                                 │   agent hooks       machine
                                                 │        │
                                                 ▼        ▼
  5                                       ┌──────────────────────────┐
                                          │ agent session starts     │
                                          │ hook → GET enabled skills│
                                          │      → writes them       │
                                          └──────────────────────────┘
                                                      │
                                                      ▼
                                          .claude/skills/<name>/SKILL.md
                                          (gitignored — generated, never committed)

  6  Add another skill  ────────▶ enabled ──▶ next session installs it too

  7  Remove a skill     ────────▶ disabled ─▶ next session deletes it from disk
                                             (only skills drymem wrote; a
                                              hand-written one is never touched)
```

## Why not keep the skills in git?

It is the obvious idea and we tried it — `.drymem/skills.lock` used to be
committed. It was wrong for four reasons, and the first is fatal:

**The web UI cannot write to your repository.** An admin clicking *Add* has a
browser, not a checkout. To put that in git the server would need write access
to every project's repo — an OAuth app, a bot account, a commit per click. That
is a large amount of machinery, and a large amount of trust to ask for, to
deliver a file the machine could just fetch.

**Two sources of truth.** The catalogue says one thing, the committed file says
another, and they disagree from the moment anybody clicks anything.

**It dirtied everyone's working tree.** The teammate's next session noticed the
difference and rewrote a *tracked* file they had not touched.

**It routes around the scanner.** A skill runs on every teammate's agent.
Publishing one goes through a scanner that refuses credentials and holds
anything suspicious for an admin to approve. Anyone with repo write access could
skip all of that by editing a file.

## What is still in the repo, and why

`.drymem/skills.lock` is written on every pull but **gitignored**. It is a cache,
not a record: an agent that starts with no network can still say which skills it
is missing. Delete it and nothing breaks.

## What a teammate has to do

Once, per repo, per machine:

```bash
npx drymem setup
```

That installs the agent hooks and registers the MCP server — something has to
tell Claude Code that drymem exists. After that they do nothing: skills appear
and disappear as the admin changes them, at the start of each session.

## Verified

This exact sequence, against a real deployment:

| Step | Result |
| --- | --- |
| Admin adds `skill-a` in the UI | `drymem: skills updated (skill-a)` at the teammate's next session |
| Admin adds `skill-b` | `1 written, 1 unchanged` → both on disk |
| Admin removes `skill-a` | `1 unchanged, 1 removed` → only `skill-b` left |
| Teammate's `git status`, throughout | clean |
