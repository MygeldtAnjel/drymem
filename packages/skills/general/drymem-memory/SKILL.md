---
name: drymem-memory
description: The memory protocol for this project — when to search memory, what to save, and what never to save. Active in every session.
---

# drymem Memory Protocol

**ALWAYS ACTIVE** — This protocol is active for every session. You MUST follow it without the user asking.

## Tools available

| Tool | When to use |
|---|---|
| `mem_context` | At session start — load recent project memory |
| `mem_search` | Before any task — find relevant past decisions |
| `mem_finalize_session` | After completing significant work, and always at session end |
| `mem_delete` | When user asks to remove a memory |

---

## Session Start (mandatory, silent)

The session-start hook has already loaded context above. You do not need to call `mem_context` again unless you need to refresh.

**Before starting any task**, silently call `mem_search` with 1-2 keywords from the user's request:
- Use SHORT keywords: `"auth"` not `"authentication system design"`
- Do not announce the search — just use the results

---

## During Work (proactive saving)

Save proactively — do NOT wait for the user to ask. Call `mem_finalize_session` silently when:
- You finish a meaningful task (bug fixed, feature added, config changed)
- You make an important decision or discovery
- The user's goal for the conversation is complete

Use a consistent `topic_key` to link related sessions.

```
project_path:  current working directory
topic_key:     short/descriptive-key  (e.g. "auth/jwt-setup", "db/migration-fix")
type:          decision | architecture | bugfix | discovery | convention | note
summary:       markdown under the five headings below
```

Do NOT announce that you are saving — just do it silently.

### The shape of a summary

Write these five headings. A teammate arriving six months later reads the
headings first and the prose only if one of them is the thing they came for.

```markdown
## Summary
What happened, in two lines.

## Why
What forced it — the constraint, the bug, the deadline. Not "we chose X"
but what made every alternative worse.

## Where
Files, services, commands, endpoints. Enough to find it again.

## Key details
The specifics worth keeping: version numbers, flags, exact error text.

## Learned
What you now know that you did not before. If nothing, say so and cut it.
```

Prose without headings still saves and still reads. The headings are what make
a memory scannable in the web UI, where each one becomes a labelled section.

### Choosing a type

| Type | The question it answers |
|---|---|
| `decision` | Why is it done this way and not the obvious way? |
| `architecture` | How is this part put together? |
| `bugfix` | What broke, why, and what actually fixed it? |
| `discovery` | What is true about this system that nobody wrote down? |
| `convention` | How does this team do this recurring thing? |
| `note` | Anything else worth not losing. |

An unrecognised type becomes `note` rather than failing the save — a taxonomy
label is never worth losing a memory over.

---

## After Context Compaction

If the context was compacted, immediately:
1. Call `mem_finalize_session` to save a summary of what was done before compaction
2. Call `mem_context` to reload recent project history
3. Continue the task

---

## Search keyword guide

| Good | Bad |
|---|---|
| `"test"` | `"test structure testing"` |
| `"auth"` | `"authentication middleware setup"` |
| `"migration"` | `"database-migration-fix"` |
