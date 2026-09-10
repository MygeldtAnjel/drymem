# @drymem/skills

Base agent skills bundled into the drymem CLI. Installed by `drymem skills sync`.

```
general/    the base set, installed in every project
```

Skills a *team* writes live in that team's own project repo under
`.claude/skills/`, never here — nobody should fork drymem to add a skill. The
server's registry indexes them; at the SaaS tier they move into Postgres per
tenant. See PLAN.md D8.

## Installing

Until `drymem skills sync` ships (drymem step 3B), copy by hand:

```bash
cp -r general/* /path/to/project/.claude/skills/
```

Project-level skills are committed with the project, so a fresh clone has them.

## The shape of a skill

Two kinds, and the difference is in the frontmatter:

**Primitives** — no invocation flag, so both you and the model can reach them.
They are disciplines, not sessions: `grilling`, `domain-modeling`, `tdd`,
`code-review`, `codebase-design`, `research`, `writing-for-agents`.

**Orchestrators** — `disable-model-invocation: true`, so only you start them.
They are usually a few lines naming the primitives they compose:

```markdown
---
name: grill-with-docs
description: A relentless interview that also writes ADRs and a glossary as we go.
disable-model-invocation: true
---

Call the Skill tool twice, for "grilling" and "domain-modeling".
```

Write new skills the same way. If a new skill is longer than a screen and does
not call another skill, it is probably a primitive that wants extracting.

## Adding a skill

1. Decide the scope: does every project want it (`general/`) or one
   (`projects/<key>/`)?
2. Follow the split above. Reuse a primitive before writing prose.
3. `writing-for-agents` is the style guide — use it.

See [ATTRIBUTION.md](ATTRIBUTION.md) for provenance and [REVIEW.md](REVIEW.md)
for why this base set was chosen.
