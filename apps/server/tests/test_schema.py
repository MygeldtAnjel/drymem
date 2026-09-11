"""The memory shape: what kind a memory is, and how its body splits into sections."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from drymem_server.schema import (
    MEMORY_TYPES,
    SECTIONS,
    canonical_section,
    normalize_type,
    split_sections,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("decision", "decision"),
        ("DECISION", "decision"),
        ("Bug Fix", "bugfix"),
        ("bug-fix", "bugfix"),
        ("adr", "decision"),
        ("insight", "discovery"),
        ("", "note"),
        (None, "note"),
        ("something nobody defined", "note"),
    ],
)
def test_normalize_type(raw, expected):
    assert normalize_type(raw) == expected


def test_every_type_normalizes_to_itself():
    for name in MEMORY_TYPES:
        assert normalize_type(name) == name


def test_splits_the_template():
    body = "\n".join(f"## {name}\nbody of {name}" for name in SECTIONS)
    lead, sections = split_sections(body)
    assert lead == ""
    assert [s.heading for s in sections] == list(SECTIONS)
    assert [canonical_section(s.heading) for s in sections] == list(SECTIONS)


def test_prose_with_no_headings_is_all_lead():
    lead, sections = split_sections("Just a paragraph.\n\nAnd another.")
    assert sections == []
    assert lead.startswith("Just a paragraph.")


def test_bold_headings_count():
    _lead, sections = split_sections("**Why**\nbecause\n\n**Learned:**\nthings")
    assert [s.heading for s in sections] == ["Why", "Learned"]
    assert sections[0].body == "because"


def test_an_emphasised_sentence_is_not_a_heading():
    """The bold form is capped short, or every emphasised line splits the body."""
    long = "**" + "word " * 20 + "**"
    _lead, sections = split_sections(f"{long}\nrest")
    assert sections == []


def test_the_teams_own_headings_survive_unlabelled():
    """A memory written before the template still reads as sections."""
    _lead, sections = split_sections("## Rollout plan\nstep one\n\n## Open questions\nnone")
    assert [s.heading for s in sections] == ["Rollout plan", "Open questions"]
    assert [canonical_section(s.heading) for s in sections] == [None, None]


def test_old_headings_map_onto_the_template():
    assert canonical_section("Problem Statement") == "Why"
    assert canonical_section("Key learnings") == "Learned"
    assert canonical_section("Affected files") == "Where"
    assert canonical_section("What") == "Summary"


def test_a_list_item_in_bold_is_not_a_heading():
    _lead, sections = split_sections("- **Why**: because\n- **Where**: here")
    assert sections == []


# The shared fixture. Both parsers read it — see the file's own comment for why.
_FIXTURE = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "packages"
        / "api-types"
        / "fixtures"
        / "sections.json"
    ).read_text()
)


@pytest.mark.parametrize("case", _FIXTURE["cases"], ids=lambda c: c["why"])
def test_shared_section_fixture(case):
    lead, sections = split_sections(case["body"])
    assert lead == case["lead"]
    assert [s.heading for s in sections] == [s["heading"] for s in case["sections"]]
    assert [canonical_section(s.heading) for s in sections] == [
        s["canonical"] for s in case["sections"]
    ]
