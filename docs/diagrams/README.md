# Flow diagrams

One picture per flow, drawn with [archify](https://github.com/tt-a1i/archify)
from the JSON in this folder. The rendered pages in `html/` are self-contained:
open one in a browser, use the guided views at the top, toggle Dark/Light.

| Page | Question it answers |
|---|---|
| [01-system](html/01-system.html) | What runs where, and what talks to what |
| [02-save-memory](html/02-save-memory.html) | What happens between `mem_finalize_session` and the 200 |
| [03-ask](html/03-ask.html) | How a chat answer is retrieved, grounded and kept |
| [04-skill-distribution](html/04-skill-distribution.html) | How a skill goes from "Add" to every teammate's `.claude/skills/`, and back out |
| [05-skill-states](html/05-skill-states.html) | Draft → scanned → pending / rejected / published → enabled → removed / deprecated |
| [06-memory-scope](html/06-memory-scope.html) | Private → shared → superseded; refused and deleted |
| [07-onboarding](html/07-onboarding.html) | Org → invite → project member → `drymem login` → `drymem setup` |
| [08-memory-lineage](html/08-memory-lineage.html) | Sources → scrubber → two stores → readers |
| [09-session-hooks](html/09-session-hooks.html) | What each Claude Code hook does, start to stop |

The diagrams describe the code as it is, not as planned. When a flow changes,
change its JSON and run `make diagrams`: it validates every file (archify
refuses overlapping labels and ambiguous routes) and re-renders `html/`.
Archify is pinned to one commit in `scripts/diagrams.sh`.
