"""
Answering a question from the team's memory, with citations.

*"Who changed the payment component last, and why?"* is the question a lead
actually arrives with. Git answers the first half slowly and the second half not
at all. This answers both from what the team wrote down.

The rule that makes it usable rather than dangerous: **every claim points at a
memory, or it is not made.** The model is given the retrieved memories and told
it may summarise them and nothing else. When retrieval finds nothing, the answer
is "nothing in this project's memory mentions that" — not a guess that reads
exactly like a fact (PLAN.md D39).

The same readable-group restriction as everywhere else applies, so an answer can
only ever be built out of what the asker was already allowed to read.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from datetime import datetime

from drymem_server.settings import settings

# Deliberately small. Eight memories at 1800 characters is a 3,500-token prompt,
# and on a local 35B model the answer degraded from a paragraph to a single word
# as it grew. Four well-chosen memories answer the question; the rest are listed
# beside the answer for the reader to open, which is what they wanted anyway.
MAX_SOURCES = 4
MAX_SOURCE_CHARS = 1200
# A grounded two-sentence answer needs very few tokens. The budget is this
# large because the local model is a *thinking* model: at 700 it spent the whole
# allowance reasoning and returned an empty `content`, which read as "drymem
# knows nothing" rather than as a misconfiguration.
MAX_ANSWER_TOKENS = 1500

# `[1]`, `[2]`, and runs like `[1][3]`. Used to strip an earlier turn's markers
# out of what the model sees, since its numbers meant that turn's memories.
_CITATION = re.compile(r"\[\d{1,2}\]")

SYSTEM = """You are drymem, answering questions about a software team's own \
history using only the memories you are given.

**This is a conversation.** After the first question you will usually be asked \
about the answer you just gave — "and why?", "was that a big change?", "who \
else?". Answer the *new* question. Never restate an answer you have already \
given: the person read it, and repeating it tells them nothing.

Rules, in order of importance:
1. Use ONLY the numbered memories. If they do not answer the question, say so \
plainly. Never fill a gap with general knowledge.
2. Cite every claim as [1], [2] — matching the numbers you were given. A \
sentence with no citation must not appear. Separate several with a space: \
"[2] [4]", never "[2][4]".
3. A citation is a marker, not a noun. Say what happened and put the marker \
after it: "the canvas was removed [4]", never "the changes in [4]" or \
"memory [3] says".
4. You did not do any of this. The memories were written by the team; say who \
did what — "Miguel asked whether the chat had been tested [2]" — and never \
"I asked" or "we decided".
5. Be short. Two or three sentences is usually right. A lead is scanning.
6. Name people and dates when the memories do. "Jose decided X on 4 September \
[2]" is worth far more than "it was decided".
7. Write dates the way a person says them — "on 12 September", not \
"2026-09-12" and not "logged on". Say what happened, not that it was recorded: \
"Ask became Chat", not "a decision was logged".
8. Lead with the answer. No "The provided memories indicate" and no "Based on \
the memories" — the citations already say where it came from.
9. Never deny and then answer. "The memories do not list the files … the files \
are X, Y, Z" is one sentence too long — if it is there, give it and stop.
10. If a question asks for a judgement the memories cannot settle — how big, \
how risky, whether it was wise — give the evidence that bears on it and say \
what the memories do not say. Do not pad it out by listing them again.
11. If the memories disagree, say that they disagree and cite both."""

TEMPLATE = """Question: {question}

Memories:

{sources}"""

# How much of the conversation the model sees. Enough for "and why?" to mean
# something; short enough that the memories stay the bulk of the prompt, which
# is the whole point of a grounded answer.
HISTORY_TURNS = 6
HISTORY_CHARS = 600


@dataclass
class Source:
    """One memory the answer may draw on, and enough of it to link back."""

    index: int
    uuid: str
    title: str
    author: str
    created_at: datetime | None
    memory_type: str
    scope: str
    # The person's name, when the org knows one. `author` is an email, and
    # nothing tells a model that `a.long.address@example.com` is the Miguel the
    # question is about — so "who decided it?" was unanswerable.
    author_name: str = ""


@dataclass
class Answer:
    question: str
    text: str
    model: str
    sources: list[Source] = field(default_factory=list)
    grounded: bool = True


def _render(sources: list[Source], bodies: dict[str, str]) -> str:
    """One block per memory, in the shape the answer should come back in.

    Two details that were quietly working against the rules above it. The date
    was rendered `2026-09-14` while rule 7 forbids writing one — the prompt was
    handing the model the format it then told it not to use. And the author was
    an email, so "who decided it?" was unanswerable: nothing said that
    `a.long.address@example.com` is the Miguel the question is about.
    """
    blocks = []
    for source in sources:
        when = source.created_at.strftime("%-d %B %Y") if source.created_at else "unknown date"
        who = source.author_name or source.author or "unknown"
        body = bodies.get(source.uuid, "")[:MAX_SOURCE_CHARS]
        blocks.append(
            f"[{source.index}] {source.title}\n"
            f"    kind: {source.memory_type} · written by {who} · {when}\n"
            f"{body}"
        )
    return "\n\n".join(blocks)


async def _answer_with_anthropic(prompt: str, turns: list[dict] | None = None) -> tuple[str, str]:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model=settings.distill_model,
        max_tokens=MAX_ANSWER_TOKENS,
        system=SYSTEM,
        messages=[*(turns or []), {"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in response.content if block.type == "text")
    return text, settings.distill_model


def _as_turns(history: list[dict] | None) -> list[dict]:
    """Earlier turns, trimmed, in the shape both clients want.

    Applied once in `answer`, not inside each client: doing it per-client
    duplicated the rule and meant anything substituted for a client — a test
    double, a third provider — silently skipped it.

    Answers are stored with their `[1]` markers, and those numbers refer to a
    *previous* turn's memories. Carried in verbatim they would collide with this
    turn's numbering, so the markers are stripped from what the model sees while
    the stored text keeps them for the reader.
    """
    if not history:
        return []
    out: list[dict] = []
    for turn in history[-HISTORY_TURNS:]:
        role = turn.get("role")
        content = (turn.get("content") or "").strip()
        if role not in ("user", "assistant") or not content:
            continue
        if role == "assistant":
            content = _CITATION.sub("", content)
            content = re.sub(r"\s{2,}", " ", content).replace(" .", ".").replace(" ,", ",")
        out.append({"role": role, "content": content[:HISTORY_CHARS]})
    return out


async def _answer_with_local(prompt: str, turns: list[dict] | None = None) -> tuple[str, str]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key="not-needed", base_url=settings.local_llm_url)
    response = await client.chat.completions.create(
        model=settings.local_llm_model,
        max_tokens=MAX_ANSWER_TOKENS,
        messages=[
            {"role": "system", "content": SYSTEM},
            *(turns or []),
            {"role": "user", "content": prompt},
        ],
        # Thinking off, and this is the key that does it.
        #
        # `chat_template_kwargs.enable_thinking` was here for months and was
        # silently ignored — measured: `finish_reason: length`, all 1500
        # tokens in `reasoning_content`, `content` empty. Which reads to a
        # person as "drymem knows nothing" rather than as a setting that never
        # took. `reasoning_effort` is the OpenAI-standard parameter and Ollama
        # honours it: the same prompt then answers in 41 tokens.
        #
        # There is nothing here to reason about anyway — the answer is a
        # summary of text the model was handed.
        
        extra_body={"reasoning_effort": "none"},
    )
    return response.choices[0].message.content or "", settings.local_llm_model


def _only_what_was_cited(text: str, sources: list[Source]) -> tuple[str, list[Source]]:
    """Keep the memories the answer used, and number them from one.

    Two separate problems, one fix.

    The engine offers four memories and the model cites the ones that bear on
    the question — often two. Listing all four under the answer claims they are
    the evidence when half of them are not.

    But filtering alone leaves the *numbers* it was given: cards badged 3 and 4
    with no 1 or 2, which reads as something broken. The badge has to match the
    marker in the prose, so both are renumbered together — first cited becomes
    [1], and the card beside it says 1.

    A marker pointing at nothing is left exactly as written. Renumbering around
    it would silently change which memory a sentence claims to rest on.
    """
    by_index = {s.index: s for s in sources}
    order: list[int] = []
    for found in _CITATION.finditer(text):
        n = int(found.group(0)[1:-1])
        if n in by_index and n not in order:
            order.append(n)

    if not order:
        return text, []

    moved = {old: new for new, old in enumerate(order, start=1)}
    renumbered = _CITATION.sub(
        lambda m: f"[{moved[int(m.group(0)[1:-1])]}]"
        if int(m.group(0)[1:-1]) in moved
        else m.group(0),
        text,
    )
    kept = [replace(by_index[old], index=new) for old, new in moved.items()]
    kept.sort(key=lambda s: s.index)
    return renumbered, kept


async def answer(
    *,
    question: str,
    sources: list[Source],
    bodies: dict[str, str],
    history: list[dict] | None = None,
) -> Answer:
    """Write the answer. With no sources, say so rather than asking a model."""
    if not sources:
        return Answer(
            question=question,
            text="Nothing in this project's memory mentions that.",
            model="none",
            sources=[],
            grounded=False,
        )

    prompt = TEMPLATE.format(question=question, sources=_render(sources, bodies))
    turns = _as_turns(history)
    if settings.anthropic_api_key:
        text, model = await _answer_with_anthropic(prompt, turns)
    else:
        text, model = await _answer_with_local(prompt, turns)

    written = text.strip()
    if not written:
        # Better to say the model gave nothing than to show a blank answer that
        # reads as "your team never wrote this down".
        return Answer(
            question=question,
            text=(
                "The model returned nothing. The memories below matched your question — "
                "open them directly."
            ),
            model=model,
            sources=sources,
            grounded=False,
        )
    written, cited = _only_what_was_cited(written, sources)
    return Answer(question=question, text=written, model=model, sources=cited)
