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

from dataclasses import dataclass, field
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

SYSTEM = """You answer questions about a software team's own history, using \
only the memories you are given.

Rules, in order of importance:
1. Use ONLY the numbered memories. If they do not answer the question, say so \
plainly. Never fill a gap with general knowledge.
2. Cite every claim as [1], [2] — matching the numbers you were given. A \
sentence with no citation must not appear.
3. Be short. Two or three sentences is usually right. A lead is scanning.
4. Name people and dates when the memories do. "Jose decided X on 4 September \
[2]" is worth far more than "it was decided".
5. If the memories disagree, say that they disagree and cite both."""

TEMPLATE = """Question: {question}

Memories:

{sources}"""


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


@dataclass
class Answer:
    question: str
    text: str
    model: str
    sources: list[Source] = field(default_factory=list)
    grounded: bool = True


def _render(sources: list[Source], bodies: dict[str, str]) -> str:
    blocks = []
    for source in sources:
        when = source.created_at.strftime("%Y-%m-%d") if source.created_at else "unknown date"
        body = bodies.get(source.uuid, "")[:MAX_SOURCE_CHARS]
        blocks.append(
            f"[{source.index}] {source.title}\n"
            f"    kind: {source.memory_type} · by {source.author or 'unknown'} · {when}\n"
            f"{body}"
        )
    return "\n\n".join(blocks)


async def _answer_with_anthropic(prompt: str) -> tuple[str, str]:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model=settings.distill_model,
        max_tokens=MAX_ANSWER_TOKENS,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in response.content if block.type == "text")
    return text, settings.distill_model


async def _answer_with_local(prompt: str) -> tuple[str, str]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key="not-needed", base_url=settings.local_llm_url)
    response = await client.chat.completions.create(
        model=settings.local_llm_model,
        max_tokens=MAX_ANSWER_TOKENS,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        # Thinking is turned off rather than budgeted for. The answer is a
        # summary of text the model was handed; there is nothing to reason
        # about, and a thinking pass here only competes for the token budget.
        # Unknown keys are ignored by servers that do not support them.
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
    return response.choices[0].message.content or "", settings.local_llm_model


async def answer(*, question: str, sources: list[Source], bodies: dict[str, str]) -> Answer:
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
    if settings.anthropic_api_key:
        text, model = await _answer_with_anthropic(prompt)
    else:
        text, model = await _answer_with_local(prompt)

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
    return Answer(question=question, text=written, model=model, sources=sources)
