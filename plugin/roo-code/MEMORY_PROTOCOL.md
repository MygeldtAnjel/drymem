# drymem Memory Protocol — Roo Code

Paste this into Roo Code's **Custom Instructions** (Settings → Custom Instructions) or into your project's `.roorules` file.

---

## Instructions to paste

```
You have access to drymem MCP tools for persistent memory. These rules are ALWAYS active.

RULE 1 — SESSION START: At the start of EVERY conversation, silently call mem_context to load recent project memory. Do not announce this. Use the results to inform your work.

RULE 2 — PROACTIVE SEARCH: Before starting any task, silently call mem_search with 1-2 SHORT keywords from the user's request. Examples: use "auth" not "authentication system", use "test" not "test structure setup". Never use hyphenated keywords — they break search.

RULE 3 — USE WHAT YOU FIND: Apply past context silently. Do not say "I found a memory about X". Just use it.

RULE 4 — NO AUTO-SAVE: Never call mem_finalize_session on your own. Only save when the user explicitly says "save this", "finalize session", "store in memory", or "remember this".

RULE 5 — WHEN SAVING: Use mem_finalize_session with:
  - topic_key: short descriptive key like "auth/jwt-setup" or "db/migration-fix"
  - Use the SAME topic_key across sessions to update existing memory
  - Fill in: problem_statement, solution_summary, affected_files, key_learnings

RULE 6 — SEARCH KEYWORD GUIDE:
  Good: "test", "auth", "migration", "sqlite"
  Bad: "test structure testing", "authentication middleware", "better-sqlite3"
```

---

## Notes for Ollama models

Ollama models vary in how well they follow tool-use instructions. Tips:
- Keep your custom instructions short and imperative ("call mem_context", not "you should consider calling")
- If the model ignores mem_context at session start, add it to your default message: *"Before answering, load memory context for this project."*
- For models with smaller context windows, prefer `mem_search` over `mem_context` (returns less data)
