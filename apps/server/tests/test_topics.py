"""
Tagging a skill.

The model is not called here: what matters is that a reply which is nearly
right still produces usable tags, and that nothing a model can do turns into an
exception a publish has to handle.
"""

from __future__ import annotations

import pytest

from drymem_server import topics


class TestClean:
    def test_normalises_what_a_model_actually_returns(self):
        # Asked for kebab-case it still sends "Code Review" and "#ci".
        assert topics.clean(["Code Review", "#ci", "  TDD  "]) == ["code-review", "ci", "tdd"]

    def test_drops_the_word_skill_and_its_friends(self):
        # Every skill is about skills. Tagging them all `skill` sorts nothing.
        assert topics.clean(["skill", "agents", "testing"]) == ["testing"]

    def test_keeps_the_first_of_a_duplicate(self):
        assert topics.clean(["ci", "CI", "ci"]) == ["ci"]

    def test_never_returns_more_than_the_row_can_show(self):
        many = [f"tag-{i}" for i in range(20)]
        assert len(topics.clean(many)) == topics.MAX_TOPICS

    def test_ignores_anything_that_is_not_a_string(self):
        assert topics.clean(["ci", None, 4, {"a": 1}]) == ["ci"]


class TestParse:
    def test_finds_the_array_inside_a_fenced_reply(self):
        text = 'Sure!\n```json\n["ai-agents", "Automation"]\n```'
        assert topics._parse(text) == ["ai-agents", "automation"]

    def test_a_reply_with_no_array_is_no_tags_not_a_crash(self):
        assert topics._parse("I could not work that out.") == []

    def test_broken_json_is_no_tags_not_a_crash(self):
        assert topics._parse('["unterminated", ') == []


@pytest.mark.asyncio
async def test_a_model_that_raises_costs_the_tags_and_nothing_else(monkeypatch):
    """The rule the whole module exists to keep: tagging never fails a publish."""

    async def boom(prompt: str) -> str:
        raise RuntimeError("engine is down")

    monkeypatch.setattr(topics, "_with_local", boom)
    monkeypatch.setattr(topics.settings, "anthropic_api_key", None)

    assert await topics.derive(name="code-review", content="# Review the diff") == []


@pytest.mark.asyncio
async def test_an_empty_skill_never_reaches_the_model(monkeypatch):
    async def fail(prompt: str) -> str:
        raise AssertionError("should not have been called")

    monkeypatch.setattr(topics, "_with_local", fail)
    monkeypatch.setattr(topics.settings, "anthropic_api_key", None)

    assert await topics.derive(name="empty", content="   ") == []
