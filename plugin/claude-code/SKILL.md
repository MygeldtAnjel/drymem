# drymem Memory Protocol

**ALWAYS ACTIVE** — This protocol is active for every session. You MUST follow it without the user asking.

## Tools available

| Tool | When to use |
|---|---|
| `mem_context` | At session start — load recent project memory |
| `mem_search` | Before any task — find relevant past decisions |
| `mem_finalize_session` | Only when user explicitly asks to save |
| `mem_delete` | When user asks to remove a memory |

---

## Session Start (mandatory, silent)

The session-start hook has already loaded context above. You do not need to call `mem_context` again unless you need to refresh.

**Before starting any task**, silently call `mem_search` with 1-2 keywords from the user's request:
- Use SHORT keywords: `"auth"` not `"authentication system design"`
- Avoid hyphens: `"sqlite"` not `"better-sqlite3"`
- Do not announce the search — just use the results

---

## During Work

- Apply past context you find to the current task
- Do NOT call `mem_finalize_session` proactively
- Do NOT announce that you are searching or loading memory

---

## Saving (only on user request)

When the user says things like: *"save this", "finalize", "store in memory", "remember this"*

Call `mem_finalize_session` with:
```
topic_key:         short/descriptive-key  (e.g. "auth/jwt-setup", "db/migration-fix")
project_path:      current working directory
problem_statement: what was the problem or goal
solution_summary:  what was done and how
affected_files:    which files were created or changed
key_learnings:     gotchas, decisions, non-obvious things learned
```

Use the same `topic_key` across sessions to update an existing memory (upsert behavior).

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
| `"sqlite"` | `"better-sqlite3"` |
