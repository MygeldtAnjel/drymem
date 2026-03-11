# drymem MCP Server Instructions (Engram Rules)

This document defines the agentic behavior rules for the drymem MCP server. These instructions must be injected into the LLM system prompt to enable proactive retrieval and curated session finalization.

---

## RULE 1: Proactive Retrieval

**At the beginning of ANY new request or task, you MUST silently execute `mem_search` using keywords from the user's prompt.**

### Behavior:
- Extract relevant keywords from the user's request (e.g., "load testing", "authentication", "database schema")
- Execute `mem_search` with those keywords and the current `project_path`
- Do NOT announce this search to the user - it should be silent
- Use the search results to inform your reasoning before generating any response

### Example:
```
User: "Help me set up load testing for our API"
→ Silently execute: mem_search(keyword="load testing", project_path="/path/to/project")
→ If results found: Review past load testing configurations, tools used, and lessons learned
→ Apply findings to the current task
```

---

## RULE 2: Context Utilization

**If the search returns project rules or past solutions, you MUST apply them to your current reasoning.**

### Behavior:
- **If project rules are found** (e.g., `rules/coding-standards`, `rules/architecture-decisions`):
  - Review and apply these rules to your current task
  - Ensure your solution aligns with established project conventions
  - Reference the specific rule when making decisions

- **If past solutions are found** (e.g., `task/api-integration`, `feature/auth-setup`):
  - Review the previous implementation and outcomes
  - Reuse proven patterns and avoid repeating past mistakes
  - Build upon existing work rather than starting from scratch

- **If nothing is found**:
  - Proceed from scratch with best practices
  - Consider creating a new memory after completing the task

---

## RULE 3: No Auto-Spam

**Do NOT automatically save minor steps or code changes to memory during the conversation.**

### Behavior:
- **DO NOT** save intermediate steps, small fixes, or incremental changes
- **DO NOT** save every function or method you write
- **DO NOT** save temporary debugging information
- **DO** focus on significant architectural decisions, patterns, and solutions
- **DO** wait until a complete solution or decision is reached before considering a save

### What NOT to save:
- ❌ Individual function implementations
- ❌ Minor bug fixes
- ❌ Temporary debugging code
- ❌ Exploratory code that gets refactored

### What TO save:
- ✅ Architectural decisions and trade-offs
- ✅ Complete feature implementations
- ✅ Problem-solution pairs with significant impact
- ✅ Patterns and best practices discovered

---

## RULE 4: Explicit Finalization

**ONLY when the user explicitly says "save this interaction in drymem" (or similar), you must generate a high-quality technical summary and execute the `mem_finalize_session` tool.**

### Behavior:
- Wait for explicit user instruction to finalize the session
- When triggered, generate a comprehensive summary covering:
  1. **topic_key**: A unique identifier for the session (e.g., `task/load-testing-setup`, `rules/solid-principles`)
  2. **problem_statement**: The original problem or task addressed
  3. **solution_summary**: A concise summary of the implemented solution
  4. **affected_files**: List of files modified or created
  5. **key_learnings**: Technical insights, patterns, or lessons learned

### Example Trigger:
```
User: "save this interaction in drymem"
→ Generate session summary
→ Execute: mem_finalize_session(
    topic_key: "task/load-testing-setup",
    problem_statement: "Set up load testing for the API",
    solution_summary: "Implemented k6 load tests with 1000 concurrent users...",
    affected_files: "src/tests/load-test.ts, package.json, .env",
    key_learnings: "k6 provides better metrics than Artillery for our use case..."
  )
→ Confirm to user that the session was saved
```

---

## RULE 5: Monorepo & Scope Awareness

**In monorepo architectures, each sub-project must maintain isolated context. Never pollute global workspace memory or bleed into other packages.**

### 1. Context Scoping (Detection)

**When starting a task, observe the file structure to detect monorepo setups.**

- **Detect monorepo patterns**: Look for `apps/`, `packages/`, `pnpm-workspace.yaml`, `lerna.json`, or similar structures
- **Identify the specific sub-project**: Determine which package/app the user is working on (e.g., `apps/mobile`, `apps/web`, `packages/ui`)
- **Determine scope**: Is the task specific to a sub-project, or does it affect the root workspace?

### 2. Targeted Retrieval & Saving (project_path logic)

**When executing `mem_search`, `mem_save`, or `mem_finalize_session`, dynamically adjust the `project_path` parameter.**

- **For sub-project tasks**: Use the specific sub-directory path (e.g., `/path/to/monorepo/apps/frontend`)
- **For root workspace tasks**: Use the root path only for global configurations (CI/CD, root linting, devops)
- **DO NOT default to root repository path** unless the task specifically involves global workspace configurations

### 3. Sub-Project Isolation

**Each sub-project gets its own isolated `project/info` record tied to its specific `project_path`.**

- **Example**: `/monorepo/apps/web` will have a `project/info` detailing its React setup
- **Example**: `/monorepo/packages/ui` will have a `project/info` detailing its Storybook setup
- **Always retrieve and update the context relevant to your current scope**

### Behavior:
- **Detect monorepo structure** at task start
- **Identify the active sub-project** based on user request and file context
- **Use specific `project_path`** for all memory operations (search, save, finalize)
- **Maintain isolation** between sub-projects to prevent context pollution

### Example:
```
User: "Add a new button component to our UI library"
→ Detect: Monorepo structure with `packages/ui/`
→ Execute: mem_search(keyword="button component", project_path="/path/to/monorepo/packages/ui")
→ Apply: UI library patterns and Storybook setup from that specific context
→ Save: mem_finalize_session with project_path="/path/to/monorepo/packages/ui"
```

---

## Summary Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT WORKFLOW                               │
├─────────────────────────────────────────────────────────────────┤
│  1. USER REQUEST RECEIVED                                       │
│     ↓                                                           │
│  2. RULE 1: Silent mem_search with keywords                     │
│     ↓                                                           │
│  3. RULE 2: Apply found context (rules/past solutions)          │
│     ↓                                                           │
│  4. EXECUTE TASK (RULE 3: No auto-save during work)            │
│     ↓                                                           │
│  5. USER REQUESTS FINALIZATION?                                 │
│     ├─ YES → RULE 4: mem_finalize_session                       │
│     └─ NO  → Task complete, no save                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tool Reference

### `mem_search`
- **Purpose**: Retrieve relevant past memories
- **Usage**: Silent execution at task start
- **Parameters**: `keyword`, `project_path`

### `mem_finalize_session`
- **Purpose**: Save a complete session summary
- **Usage**: Only on explicit user request
- **Parameters**: `topic_key`, `problem_statement`, `solution_summary`, `affected_files`, `key_learnings`

### `mem_save`
- **Purpose**: Save individual architectural decisions
- **Usage**: When a significant decision is made during the session
- **Parameters**: `topic_key`, `project_path`, `scope`, `content`, `status`

---

*This document defines the Engram-inspired agentic behavior for drymem. Follow these rules to maintain a curated, high-value memory system.*
