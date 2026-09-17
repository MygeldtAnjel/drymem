---
name: handoff
description: Hand the current work to whoever picks it up next, by saving it to the project's memory.
argument-hint: "What will the next session be used for?"
disable-model-invocation: true
---

Call `mem_finalize_session` with a summary of the current work so the next
session — yours or a teammate's — starts from it.

Use a `topic_key` that names the work, not the session: `payments/adyen-retry`,
not `handoff-tuesday`. A stable key is what lets later updates attach to the
same thread instead of starting a new one.

Include, in this order:

1. **What was being done, and why.** The goal, not the steps.
2. **What is settled.** Decisions made, and the reason each one was made — a
   decision without its reason gets re-litigated.
3. **What is still open.** Named questions, not "various issues".
4. **Where the work is.** Branch, files, commands to run. Reference specs, ADRs
   and commits by path rather than restating them.
5. **What was tried and rejected.** The most valuable part and the most often
   omitted: it is what stops the next person repeating a dead end.

Do not paste conversation, diffs, or file contents. A memory is a conclusion,
not a transcript.

The server redacts obvious secrets, but that is a backstop and not a licence:
leave credentials, tokens and personal data out of the summary yourself.

If the user passed arguments, treat them as what the next session will focus on
and slant the summary towards it.

> Handing off through memory rather than a file in `/tmp` is the point: a file
> is on one machine, and the person who needs it is usually on another.
