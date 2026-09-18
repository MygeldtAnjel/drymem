# Attribution

17 of the skills under `general/` are forked from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT licensed,
Copyright (c) 2026 Matt Pocock. Forked on 2026-09-10.

We kept his structure — small model-invoked primitives, thin user-invoked
orchestrators that compose them — because it is the right shape for Claude Code
skills, and we say so plainly rather than pretending we invented it.

## Changes we made

| Skill | Change | Why |
|---|---|---|
| `to-spec` | writes `docs/specs/<slug>.md` instead of publishing to an issue tracker | we are tracker-agnostic |
| `to-tickets` | writes `docs/tickets/<feature>/<NN>-<slug>.md`; tracker branch removed | same |
| `code-review` | resolves specs from `docs/specs/` and `docs/tickets/` instead of a tracker config | same |
| `handoff` | rewritten to call `mem_finalize_session` instead of writing a file to the OS temp directory | drymem *is* the handoff; a file in `/tmp` is on one machine and the person who needs it is usually on another |

Nothing else was edited. Skills are prose written for a model; changing wording
without evidence makes them worse, and we have no evidence yet. Improvements
come from pilot data (drymem step 5), not from taste.

## Skills we did not fork

`ask-matt` and `setup-matt-pocock-skills` (his router and repo config — replaced
by `drymem skills sync`), `triage` and `wayfinder` (bound to an issue-tracker
state machine we don't run), `improve-codebase-architecture`, `prototype`,
`wizard`, `to-questionnaire` (niche — add on demand), and everything under his
`in-progress/` and `misc/`.
