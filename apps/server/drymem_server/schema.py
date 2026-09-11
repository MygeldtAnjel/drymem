"""
The shape of a memory: what kind it is, and what a well-written one says.

Two things live here because both the MCP tool description, the validator and
the UI must agree on them, and three copies of a list drift within a week.

`MEMORY_TYPES` is deliberately short. A taxonomy an author has to think about
is a taxonomy they will get wrong; six kinds fit in a glance and each answers a
different question a teammate arrives with.

`SECTIONS` is a *convention*, not a schema. The body stays one markdown string:
an agent that follows the template gets a structured entry, one that does not
still gets stored and still reads fine. Storing five columns instead would have
made every memory written before today unreadable, and every memory written by
a tool that does not know the template unwritable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

MEMORY_TYPES: dict[str, str] = {
    "decision": "A choice the team made, and what it rules out",
    "architecture": "How a part of the system is put together",
    "bugfix": "A defect, its cause, and what actually fixed it",
    "discovery": "Something true about the system nobody had written down",
    "convention": "How this team does a recurring thing",
    "note": "Anything else worth not losing",
}

DEFAULT_TYPE = "note"

SECTIONS: tuple[str, ...] = ("Summary", "Why", "Where", "Key details", "Learned")

TEMPLATE = "\n\n".join(f"## {name}\n…" for name in SECTIONS)


def normalize_type(raw: str | None) -> str:
    """Map anything an agent sends to a known type, defaulting rather than failing.

    A save is expensive and irreplaceable; refusing one over a taxonomy label
    would trade the memory for a detail no reader depends on.
    """
    if not raw:
        return DEFAULT_TYPE
    key = raw.strip().lower().replace(" ", "").replace("-", "").replace("_", "")
    aliases = {
        "bug": "bugfix",
        "fix": "bugfix",
        "bugfix": "bugfix",
        "arch": "architecture",
        "design": "architecture",
        "adr": "decision",
        "learning": "discovery",
        "insight": "discovery",
        "pattern": "convention",
        "standard": "convention",
    }
    if key in MEMORY_TYPES:
        return key
    return aliases.get(key, DEFAULT_TYPE)


@dataclass(frozen=True)
class Section:
    heading: str
    body: str


# A heading is `## Why`, `### Why`, `**Why**` or `**Why:**` — all four turn up in
# what agents actually write, and a parser that accepts one of them finds nothing.
# The bold form is capped much shorter than the hash form: `**…**` on its own
# line is a real heading at six words and an emphasised sentence at thirty.
_HEADING = re.compile(
    r"^\s*(?:#{1,4}\s+(?P<hash>[^\n#]{1,160}?)|\*\*(?P<bold>[^\n*]{1,60}?)\*\*\s*:?)\s*$"
)

_CANON = {name.lower().replace(" ", ""): name for name in SECTIONS}
_CANON.update(
    {
        "what": "Summary",
        "problem": "Why",
        "problemstatement": "Why",
        "context": "Why",
        "solution": "Key details",
        "keydetail": "Key details",
        "details": "Key details",
        "files": "Where",
        "affectedfiles": "Where",
        "learnings": "Learned",
        "keylearnings": "Learned",
        "lessons": "Learned",
        "lessonslearned": "Learned",
    }
)


def canonical_section(heading: str) -> str | None:
    """The template section a heading means, or None if it is the author's own."""
    key = heading.strip().rstrip(":").lower().replace(" ", "").replace("-", "")
    return _CANON.get(key)


def split_sections(body: str) -> tuple[str, list[Section]]:
    """Split a markdown body into its lead paragraph and its headed sections.

    Returns every section, canonical or not — an entry that uses the team's own
    headings should still render as sections, just unlabelled by the template.
    """
    lines = body.splitlines()
    lead: list[str] = []
    sections: list[tuple[str, list[str]]] = []

    for line in lines:
        match = _HEADING.match(line)
        heading = (match.group("hash") or match.group("bold")) if match else None
        if heading and heading.strip() not in {"", "---"}:
            sections.append((heading.strip().rstrip(":"), []))
        elif sections:
            sections[-1][1].append(line)
        else:
            lead.append(line)

    return (
        "\n".join(lead).strip(),
        [Section(heading=h, body="\n".join(b).strip()) for h, b in sections],
    )


__all__ = [
    "DEFAULT_TYPE",
    "MEMORY_TYPES",
    "SECTIONS",
    "TEMPLATE",
    "Section",
    "canonical_section",
    "normalize_type",
    "split_sections",
]
