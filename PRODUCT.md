# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vite + React + TypeScript, building to static assets that the FastAPI server
serves at `/`. Chosen to match `apps/cli` (same toolchain, same pnpm workspace)
and to share request/response types from `@drymem/api-types`, so the UI cannot
drift from the API it reads.

## Users

**Developers and vibe coders on a 3–6 person team**, all using AI coding agents
— Claude Code today, OpenCode alongside it. They span real range: some read a
stack trace for fun, some are shipping real software while still learning the
vocabulary. The UI has to stay dense enough that an engineer does not feel
babysat, and plain enough that someone newer is never stuck guessing what a
control does.

They arrive with a specific question, not to browse: *did anyone already solve
this?*, *what did we decide about payments?*, *is that memory wrong?* They are
mid-task, with an agent session open in another window.

## Product Purpose

drymem gives a team's AI agents memory that survives the session. An agent
records what it learned; the next person's agent starts from it instead of from
zero.

The web UI is where a **human** sees that memory: read it, judge it, correct it,
and decide what is worth sharing. Success is that someone opens it, finds the
answer or the wrong memory, and acts — in under a minute.

## Positioning

Competitors store memories as files or keyword-searchable rows, per person.
drymem stores them in a temporal knowledge graph, so a later fact supersedes an
earlier contradicting one and search returns what is true *now*. Memories are
private by default and shared only by an explicit human act. Nothing leaves the
network: extraction runs on a local model.

The differentiator no competitor has: memory feeds back into the team's skills
(`skills discover` / `skills distill`).

## Operating Context

- Opened on the machine running the server, at `http://localhost:8080`, while an
  agent session is running in another window. Localhost only for now; the design
  must not assume a single user so pointing it at a shared host later needs no rework.
- Authentication is the same bearer token the CLI uses, created by
  `drymem-admin token-create`. There is no password, no signup, no email.
- The same data is reachable through `drymem ui` (terminal) and the MCP tools
  (from inside an agent). The web UI is the reading and judging surface, not the
  only one.
- Memory content is **markdown**, written by an agent: headings, bullets, fenced
  code, and file paths. Some are three lines, some are several screens.

## Capabilities and Constraints

**The UI reads and acts on:** projects (with memory counts and a useful-ratio),
recent memories, graph search returning *facts* rather than documents, one
memory in full, 👍/👎 ratings, promote (private → team), and delete.

**Vocabulary that is product truth, not jargon to design away:**
*memory* (a summary an agent saved), *fact* (an edge the graph extracted),
*superseded* (a fact a later memory contradicted), *promote* (share with the
team), *project* (identified by its git remote), *scope* (`private` or `team`).

**Constraints:**
- Conversations are never stored. There is nothing to browse but summaries, by design.
- Search is slow enough to need a pending state — it runs embeddings and graph
  traversal, not a LIKE query.
- A memory can be several screens of markdown; it must be readable, not truncated.
- Delete is permanent and there is no undo.
- Ratings carry the query that surfaced the memory; a rating without one is far
  less useful.

## Brand Commitments

Name: **drymem**, lowercase. No logo, no colors, no typography chosen yet —
nothing is binding.

Voice, from the CLI and the onboarding page: plain, direct, short sentences. It
says what happened and what to do. It does not congratulate the user or
apologise. Copy in the UI should match that register.

## Evidence on Hand

Real data exists in the running instance: one project, 12 memories written
during this build, one rating, and a graph of ~60 entities. Screens must be
designed against that shape — long markdown bodies, `topic/sub-topic` names,
email authors, ISO timestamps.

**Do not fabricate:** teammate names, adoption numbers, testimonials, uptime
claims, or a pricing tier. The pilot has not run.

## Product Principles

1. **A memory is a conclusion, not a transcript.** Everything on screen is
   something a person or their agent chose to write down. Never imply we have
   more than that.
2. **Private until someone shares it.** Sharing is an act with a name on it, and
   the UI must never make it feel automatic or accidental.
3. **Judging is the job.** Rating and deleting are not admin chores bolted on —
   they are how the memory stays worth reading. They deserve first-class placement.
4. **Say which, not just that.** "Redacted 1× aws-key" beats "secret removed";
   "superseded" beats hiding the old fact. The product's value is precision.
5. **Dense for an engineer, legible for a learner.** No dumbing down and no
   insider shorthand; every control says what it does.

## Accessibility & Inclusion

No formal standard was set. Product-specific needs: memory bodies are long-form
reading, so type must hold up at length; `superseded`, `team` and `private` are
meaningful states that must not be carried by colour alone; and the whole
surface must be keyboard-operable, because its users are already keyboard-first.
