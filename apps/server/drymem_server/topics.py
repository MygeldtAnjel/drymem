"""
What a skill is *about*, as a handful of tags.

A catalogue is browsed, not searched: somebody arrives without knowing what they
are looking for, and tags are how a page says "these are the testing ones"
without them reading twenty descriptions. The card and the skill header had
nothing to fill that row with — `topic` holds one free-text string and only
distilled skills ever set it.

Tags are derived from the skill's own text at the one moment the information is
free: when somebody hands us the document. Never at read time, which would make
browsing wait on a model.

Deriving is **best effort and never blocks a publish**. A skill with no tags is
a slightly worse card; a publish that fails because the tagger was down is a
person who cannot do their job.
"""

from __future__ import annotations

import json
import logging
import re

from drymem_server.settings import settings

logger = logging.getLogger(__name__)

# Enough to characterise a skill, few enough to read in one glance. Past about
# six the row wraps and stops being scannable, which is the whole point of it.
MAX_TOPICS = 6
MAX_SKILL_CHARS = 3000
MAX_TOPIC_TOKENS = 200

# `ai-agents`, `test-driven-development`. Lowercase words joined by hyphens, so
# a tag is safe in a URL and looks the same wherever it is rendered.
_TAG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_NOT_A_TAG = frozenset({"skill", "skills", "agent", "agents", "claude", "drymem", "md"})

SYSTEM = """You label developer tools with topic tags.

Given a SKILL.md — an instruction document a coding agent loads — reply with the \
topics it is about.

Rules:
- Between 3 and 6 tags.
- Lowercase, hyphenated: "test-driven-development", "code-review", "ci".
- Topics, not restatements of the title. A skill called "code-review" is about \
code-review, but also about quality, standards and collaboration.
- What a person browsing a catalogue would filter by. Broad enough that other \
skills could share the tag.
- No tool names unless the skill is genuinely specific to one.
- Reply with a JSON array of strings and nothing else: ["a", "b", "c"]"""


def clean(raw: list[str]) -> list[str]:
    """Only well-formed, useful tags, deduplicated, in the order given.

    A model asked for JSON sometimes returns `Code Review` or `#ci`. Rather than
    reject the whole reply for one bad entry, each tag is normalised and the
    ones that still do not fit the shape are dropped.
    """
    out: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            continue
        tag = re.sub(r"[^a-z0-9]+", "-", item.strip().lower()).strip("-")
        if not tag or not _TAG.match(tag) or len(tag) > 40:
            continue
        if tag in _NOT_A_TAG or tag in out:
            continue
        out.append(tag)
        if len(out) == MAX_TOPICS:
            break
    return out


def _parse(text: str) -> list[str]:
    """The array out of a reply that may have prose or a fence around it."""
    match = re.search(r"\[.*?\]", text, re.DOTALL)
    if not match:
        return []
    try:
        loaded = json.loads(match.group(0))
    except json.JSONDecodeError:
        return []
    return clean(loaded) if isinstance(loaded, list) else []


async def _with_local(prompt: str) -> str:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key="not-needed", base_url=settings.local_llm_url)
    response = await client.chat.completions.create(
        model=settings.local_llm_model,
        max_tokens=MAX_TOPIC_TOKENS,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
        # The local model is a thinking model. Without this it spends the whole
        # budget reasoning and returns an empty `content` — the same failure
        # that made Ask look like it knew nothing.
        extra_body={"reasoning_effort": "none"},
    )
    return response.choices[0].message.content or ""


async def _with_anthropic(prompt: str) -> str:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model=settings.distill_model,
        max_tokens=MAX_TOPIC_TOKENS,
        system=SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(block.text for block in response.content if block.type == "text")


async def derive(*, name: str, content: str) -> list[str]:
    """Tags for one skill. An empty list whenever anything at all goes wrong."""
    body = (content or "").strip()
    if not body:
        return []

    prompt = f"Skill name: {name}\n\n{body[:MAX_SKILL_CHARS]}"
    try:
        if settings.anthropic_api_key:
            return _parse(await _with_anthropic(prompt))
        return _parse(await _with_local(prompt))
    except Exception:
        # Every failure is the same failure here: no tags. A model that is down,
        # a timeout, a reply that is not JSON — none of them are worth a
        # different answer, and none may be the reason a publish fails.
        logger.warning("could not derive topics for %s", name, exc_info=True)
        return []
