"""
How good are the answers, really?

Every prompt rule in `ask.py` is a claim about output that nobody was checking.
This runs real questions against the real model and grades what comes back —
both the mechanical rules, which are objective, and the substance, by looking
for a fact the answer has to contain if it understood the question.

It is a tool, not a test: the model is non-deterministic and a score of 9/10 on
one run and 8/10 on the next is normal. What it is for is seeing *which* rules
get broken, so prompt work is aimed rather than guessed.

    make eval                # every case
    make eval CASE=refusal   # one group

A case with `expect` asserts the answer contains that text. A case with
`refuse` asserts it declines — those are the ones that catch a model inventing
history, which is the failure that matters most.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("DRYMEM_URL", "http://127.0.0.1:8080")

# Each rule is a name, a pattern that means it was broken, and why it matters.
# Checked only on answers that actually answered: a refusal has no citations to
# space out and no dates to write.
BROKEN = [
    ("first person", re.compile(r"\b(I asked|I decided|I found|we decided|we built)\b", re.IGNORECASE),
     "the memories were written by the team, not by the answer"),
    # "…for only 20 memories [2]" is a correct citation after a noun; what the
    # rule is for is the citation used as a referent. So it needs a preposition
    # in front or a verb behind, not just the word "memory" nearby.
    ("citation as a noun", re.compile(r"\b((in|from|per|see) memor(y|ies) \[\d+\]|memor(y|ies) \[\d+\] (says|records|states|shows|notes)|changes? in \[\d+\]|\[\d+\] (says|records|states))", re.IGNORECASE),
     "a citation is a marker after a claim, not a thing to talk about"),
    ("iso date", re.compile(r"\b20\d\d-\d\d-\d\d\b"),
     "people say 'on 14 September'"),
    ("preamble", re.compile(r"^(based on|according to|the provided memories)", re.IGNORECASE),
     "the citations already say where it came from"),
    ("citations jammed", re.compile(r"\]\["),
     "'[1][2]' reads as one number"),
    ("denies then answers", re.compile(r"do not (list|specify|say)[^.]*\.\s*(The|Those|These)\b[^.]*(are|were|is|was)\b", re.IGNORECASE),
     "if it is there, give it and stop"),
]


def ask(token: str, project: str, question: str, chat_id: str | None) -> dict:
    body = {"project_key": project, "question": question}
    if chat_id:
        body["chat_id"] = chat_id
    request = urllib.request.Request(
        f"{BASE}/v1/chats/ask",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.loads(response.read())


def grade(answer: str, sources: list[dict], case: dict) -> list[str]:
    """Everything wrong with one answer, in words."""
    faults: list[str] = []
    refused = bool(re.search(r"\b(do not|does not|no memor|nothing in)\b", answer, re.IGNORECASE))

    if case.get("refuse"):
        if not refused:
            faults.append("answered a question the memories cannot answer")
    else:
        for wanted in case.get("expect", []):
            if wanted.lower() not in answer.lower():
                faults.append(f"missing: {wanted!r}")
        if refused:
            faults.append("refused a question the memories do answer")

    if not refused:
        if not re.search(r"\[\d+\]", answer):
            faults.append("no citation anywhere")
        for name, pattern, why in BROKEN:
            if pattern.search(answer):
                faults.append(f"{name} — {why}")

    # The cards are renumbered from one; a gap means something is wrong.
    numbers = [s["index"] for s in sources]
    if numbers and numbers != list(range(1, len(numbers) + 1)):
        faults.append(f"source numbering has holes: {numbers}")
    cited = {int(n) for n in re.findall(r"\[(\d+)\]", answer)}
    extra = {n for n in numbers} - cited
    if extra:
        faults.append(f"showed uncited sources: {sorted(extra)}")
    # The one this originally missed: an answer citing [5] with one card under
    # it. A citation the reader cannot open is worse than no citation.
    dangling = cited - set(numbers)
    if dangling:
        faults.append(f"cited sources that are not shown: {sorted(dangling)}")
    return faults


CASES: list[dict] = [
    {
        "group": "grounded",
        "ask": "Why was the everything canvas removed from the decisions page?",
        "expect": ["509"],
    },
    {
        "group": "grounded",
        "ask": "Why is the decision tree built from file paths?",
        "expect": ["path"],
    },
    {
        "group": "grounded",
        "ask": "What went wrong with the local model returning empty answers?",
        "expect": ["think"],
    },
    {
        "group": "refusal",
        "ask": "What did we decide about the Kubernetes ingress controller?",
        "refuse": True,
    },
    {
        "group": "refusal",
        "ask": "Why did we migrate from MySQL to CockroachDB?",
        "refuse": True,
    },
    {
        "group": "conversation",
        "ask": "What was the last decision about the graph?",
        "then": [
            {"ask": "what files did that touch?", "expect": [".tsx"]},
            {"ask": "and who decided it?", "expect": ["Miguel"]},
        ],
    },
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--token", default=os.environ.get("DRYMEM_TOKEN", ""))
    parser.add_argument("--project", default=os.environ.get("DRYMEM_PROJECT", ""))
    parser.add_argument("--case", default="", help="only this group")
    parser.add_argument("--keep", action="store_true", help="leave the chats behind")
    args = parser.parse_args()

    if not args.token or not args.project:
        print("Need --token and --project (or DRYMEM_TOKEN / DRYMEM_PROJECT).", file=sys.stderr)
        return 2

    cases = [c for c in CASES if not args.case or c["group"] == args.case]
    clean = 0
    total = 0
    chats: list[str] = []

    for case in cases:
        turns = [case] + case.get("then", [])
        chat_id = None
        for turn in turns:
            total += 1
            started = time.monotonic()
            try:
                result = ask(args.token, args.project, turn["ask"], chat_id)
            except (urllib.error.URLError, TimeoutError) as exc:
                print(f"  ✗ {turn['ask'][:58]}\n      request failed: {exc}")
                continue
            chat_id = result["chat_id"]
            if chat_id not in chats:
                chats.append(chat_id)

            message = result["message"]
            faults = grade(message["content"], message["sources"], turn)
            took = time.monotonic() - started
            mark = "✓" if not faults else "✗"
            if not faults:
                clean += 1
            print(f"  {mark} [{case['group']}] {turn['ask'][:58]}  ({took:.0f}s)")
            for fault in faults:
                print(f"      {fault}")
            if faults:
                print(f"      → {message['content'][:150]}")

    print(f"\n{clean}/{total} answers clean")
    if chats and not args.keep:
        print(f"({len(chats)} chats created; pass --keep to leave them)")
    return 0 if clean == total else 1


if __name__ == "__main__":
    raise SystemExit(main())
