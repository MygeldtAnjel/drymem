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
summary:       structured markdown — include problem, solution, affected files, key learnings
```

Do NOT announce that you are saving — just do it silently.

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
