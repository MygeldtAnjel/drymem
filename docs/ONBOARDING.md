# drymem — one page to get started

Shared memory for the team's AI coding agents. When you finish something, your
agent writes down what it learned. When someone else picks that work up, their
agent already knows.

**You need:** Node 20+, Claude Code, and a token from whoever runs the server.

---

## Install

```bash
npx drymem@latest setup
```

It asks for the server URL and your token, then registers the MCP server and
session hooks. **Restart Claude Code afterwards.**

Check it worked:

```bash
npx drymem whoami
```

```
project: github.com/acme/payments
server:  https://drymem.internal
health:  ok (postgres true, neo4j true)
```

If the project line says `local/…`, this directory has no git remote. drymem
identifies a project by its remote, so that everyone's clone resolves to the
same place — a repo without one gets a private, machine-local key instead.

---

## What happens on its own

Nothing to remember. Once installed:

- **At session start** your agent is given the project's recent memories.
- **While you work** it searches memory before starting a task.
- **When you finish** it saves a summary. If it forgets, a hook saves one for you.

---

## What you do by hand

### See what the team knows

```bash
npx drymem ui
```

`j`/`k` to move, `enter` to open, `/` to search, `q` to quit.
On a memory: `+` useful, `-` not useful, `p` share, `d` delete.

**Please rate things.** The thumbs are the only measure of whether retrieval is
any good, and a rating carries the search that surfaced it — "wrong answer to
*auth*" is a signal, "bad memory" is not.

### Share something

Memories are **private until you share them**. Nobody sees yours unless you
decide they should:

```bash
npx drymem promote <episode-id>     # or press p in the UI
```

Sharing copies the memory to the team. Your own copy stays.

### Install the team's skills

```bash
npx drymem skills sync
```

Writes `.claude/skills/` and a lock file, both committed, so everyone has the
same set. It **never overwrites a skill you edited** and never touches one you
wrote yourself.

---

## What gets stored, and what does not

**Stored:** summaries your agent writes — what the problem was, what was done,
what was learned.

**Not stored:** your conversations. drymem has no access to transcripts and
does not read them. There is no way to browse what anyone typed, by design.

Secrets are stripped server-side before anything is saved. If a private key
ever reaches it, the save is **refused** rather than quietly cleaned up — so
you find out and can rotate it.

---

## Writing a memory worth keeping

Your agent does this, but it is worth knowing what good looks like, because you
will read these later.

| Keep | Skip |
|---|---|
| The constraint you hit, and why it bit | What you typed |
| The approach you rejected, and why | A diff or a file dump |
| A decision, with its reason | "Fixed the bug" |
| Where the work is — branch, files | Anything a commit already says |

The most valuable and most often missing part is **what was tried and rejected**.
It is what stops the next person walking into the same wall.

Use a `topic_key` that names the work, not the day: `payments/adyen-retry`,
not `tuesday-session`. A stable key is what lets later updates attach to the
same thread.

---

## Troubleshooting

**"Not authorised"** — your token is wrong or revoked. Re-run
`npx drymem setup`.

**"Cannot reach the drymem server"** — the server is down or you are off the
network. Your work is unaffected; memory simply will not save until it is back.

**"The server did not answer within…"** — extraction is slow on a large memory.
It probably *did* save. Check with `npx drymem context 5` before retrying.

**Nothing appears at session start** — the hooks did not install. Re-run setup
and restart Claude Code.

**A memory has something in it that should not be there** — open the UI, find
it, press `d`. Deletion removes it from the graph and the index.

---

## A note on the first two weeks

The graph starts nearly empty, so it will pay back very little at first. That is
expected and it is the point of the pilot: it compounds, or it does not, and we
want to know which.

Two things make the difference: **rate what you retrieve**, and **share what
would have saved someone else an afternoon**. Everything else runs itself.
