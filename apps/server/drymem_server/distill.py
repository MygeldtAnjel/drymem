"""
Drafting a skill from the memories that prompted it.

The output is always a **draft for a human to review**, never something that
installs itself. A skill changes how every agent on the team behaves; a model
writing one unsupervised, from its own summary of its own sessions, is a loop
with nobody in it.

Two backends, same as extraction: the local model by default so this works with
no API key, and Claude Opus 5 when one is configured. Drafting is the one place
where model quality shows most — extraction just needs to be consistent, but a
skill is prose a person has to read and act on.
"""

from __future__ import annotations

from dataclasses import dataclass

from drymem_server.settings import settings

MAX_MEMORY_CHARS = 2500
MAX_DRAFT_TOKENS = 4000

SYSTEM = """You write agent skills: short instruction documents that a coding \
agent reads and follows.

You will be given memories a development team recorded while working. Write one \
SKILL.md that captures what they learned, so the next agent does not repeat it.

Rules:
- Start with YAML frontmatter: name, description. Nothing else.
- The description says when to reach for this skill, in one sentence.
- The body is instructions, not a summary. Write what to DO.
- Ground every instruction in the memories. Invent nothing.
- If the memories name a constraint, a trap, or an approach that was tried and \
rejected, that is the most valuable part — say it and say why.
- Be brief. A skill people actually read is under a screen.
- Do not mention that this was generated, or reference "the memories"."""

# The subject is a part of the codebase now (`apps/api`, `packages/skills`),
# not an extracted noun, so the prompt names it as one — otherwise the model
# writes about the folder rather than about working in it.
TEMPLATE = """Part of the codebase: {topic}

Memories the team recorded while working on it:

{memories}

Write the SKILL.md an agent should read before it touches {topic}."""


@dataclass(frozen=True)
class Draft:
    topic: str
    name: str
    content: str
    model: str
    memory_count: int


def _slug(topic: str) -> str:
    slug = "".join(c if c.isalnum() else "-" for c in topic.lower())
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug.strip("-")[:60] or "untitled"


def _prompt_for(topic: str, memories: list[dict]) -> str:
    blocks = []
    for memory in memories:
        content = (memory.get("content") or "").strip()[:MAX_MEMORY_CHARS]
        if content:
            blocks.append(f"--- {memory.get('name') or 'memory'}\n{content}")
    return TEMPLATE.format(topic=topic, memories="\n\n".join(blocks))


async def _draft_with_anthropic(prompt: str) -> tuple[str, str]:
    from anthropic import AsyncAnthropic

    client = AsyncAnthropic(api_key=settings.anthropic_api_key)
    response = await client.messages.create(
        model=settings.distill_model,
        max_tokens=MAX_DRAFT_TOKENS,
        system=SYSTEM,
        thinking={"type": "adaptive"},
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(block.text for block in response.content if block.type == "text")
    return text, settings.distill_model


async def _draft_with_local(prompt: str) -> tuple[str, str]:
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key="not-needed", base_url=settings.local_llm_url)
    response = await client.chat.completions.create(
        model=settings.local_llm_model,
        max_tokens=MAX_DRAFT_TOKENS,
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": prompt},
        ],
    )
    return response.choices[0].message.content or "", settings.local_llm_model


def _ensure_frontmatter(content: str, name: str, topic: str) -> str:
    """Give the draft exactly one frontmatter block.

    Models emit three shapes here. A proper block is left alone. Bare `name:` /
    `description:` lines with no delimiters get wrapped — prepending a header
    instead would leave those lines stranded in the body, which is what
    happened on the first real run. Anything else gets a generated header,
    because a draft without one is still worth reading.
    """
    stripped = content.lstrip()
    if stripped.startswith("---"):
        return stripped

    lines = stripped.splitlines()
    keys = ("name:", "description:")
    leading = 0
    for line in lines:
        if line.strip().startswith(keys):
            leading += 1
            continue
        if leading and not line.strip():
            break
        if leading:
            break
        break

    if leading:
        head = "\n".join(lines[:leading])
        body = "\n".join(lines[leading:]).lstrip()
        return f"---\n{head}\n---\n\n{body}"

    return (
        f"---\nname: {name}\ndescription: What this team learned working on {topic}.\n---\n\n{stripped}"
    )


def _tidy(text: str) -> str:
    """Strip a code fence if the model wrapped the whole document in one."""
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return stripped


async def draft_skill(topic: str, memories: list[dict]) -> Draft:
    """Draft a SKILL.md for `topic`. Raises if there is nothing to write from."""
    if not memories:
        raise ValueError(f"No memories about {topic!r} to write from.")

    prompt = _prompt_for(topic, memories)
    if settings.anthropic_api_key:
        content, model = await _draft_with_anthropic(prompt)
    else:
        content, model = await _draft_with_local(prompt)

    content = _tidy(content)
    if not content:
        raise ValueError("The model returned an empty draft.")

    name = _slug(topic)
    content = _ensure_frontmatter(content, name, topic)

    return Draft(topic=topic, name=name, content=content, model=model, memory_count=len(memories))
