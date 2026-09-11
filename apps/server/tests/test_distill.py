"""
Drafting a skill from memories.

The guard that matters: the output is a *draft*. Nothing here installs anything,
and a model that returns junk must fail loudly rather than produce a plausible
file that quietly changes how every agent on the team behaves.
"""

from __future__ import annotations

import pytest

from drymem_server import distill
from drymem_server.discover import GENERIC, Cluster, _is_generic
from drymem_server.distill import Draft, _slug, _tidy, draft_skill

MEMORIES = [
    {"name": "payments/adyen", "content": "Adyen rejects zero-amount authorisations."},
    {"name": "payments/retry", "content": "The retry loop had no upper bound."},
]


class TestClustering:
    def test_a_project_wide_name_is_not_a_topic(self):
        """'drymem' appears in every memory; it says nothing about what is hard."""
        for name in GENERIC:
            assert _is_generic(name)

    def test_a_real_subject_is(self):
        assert not _is_generic("Adyen")
        assert not _is_generic("token refresh")

    def test_very_short_names_are_noise(self):
        assert _is_generic("a")
        assert _is_generic("x")

    def test_a_cluster_serialises_for_the_api(self):
        cluster = Cluster(topic="Adyen", memory_count=3, episode_uuids=["a"], facts=["f"])
        assert cluster.as_dict() == {
            "topic": "Adyen",
            "memory_count": 3,
            "episode_uuids": ["a"],
            "facts": ["f"],
        }


class TestSlug:
    @pytest.mark.parametrize(
        "topic,expected",
        [
            ("Adyen", "adyen"),
            ("token refresh", "token-refresh"),
            ("Neo4j / Graphiti", "neo4j-graphiti"),
            ("  spaced  ", "spaced"),
            ("!!!", "untitled"),
        ],
    )
    def test_makes_a_usable_directory_name(self, topic, expected):
        assert _slug(topic) == expected


class TestTidy:
    def test_unwraps_a_fenced_document(self):
        assert _tidy("```markdown\n---\nname: x\n---\nbody\n```") == "---\nname: x\n---\nbody"

    def test_leaves_an_unfenced_one_alone(self):
        assert _tidy("---\nname: x\n---\nbody") == "---\nname: x\n---\nbody"

    def test_keeps_fences_that_are_part_of_the_content(self):
        text = "---\nname: x\n---\n\nRun:\n\n```bash\nmake test\n```"
        assert _tidy(text) == text


class TestDrafting:
    async def test_produces_a_skill_with_frontmatter(self, monkeypatch):
        async def fake(prompt):
            return (
                "---\nname: adyen\ndescription: Adyen quirks.\n---\n\nUse a 1-cent auth.",
                "local",
            )

        monkeypatch.setattr(distill, "_draft_with_local", fake)
        monkeypatch.setattr(distill.settings, "anthropic_api_key", None)

        draft = await draft_skill("Adyen", MEMORIES)

        assert isinstance(draft, Draft)
        assert draft.content.startswith("---")
        assert draft.name == "adyen"
        assert draft.memory_count == 2

    async def test_wraps_bare_frontmatter_keys_rather_than_stacking_a_header(self, monkeypatch):
        """Seen on the first real run: the model emitted the keys without `---`,
        so a prepended header left them stranded in the body."""

        async def fake(prompt):
            return (
                "name: graphiti-pitfalls\n"
                "description: When working with Graphiti.\n\n"
                "Pin the version exactly."
            ), "local"

        monkeypatch.setattr(distill, "_draft_with_local", fake)
        monkeypatch.setattr(distill.settings, "anthropic_api_key", None)

        draft = await draft_skill("Graphiti", MEMORIES)

        assert draft.content.count("---") == 2, "exactly one frontmatter block"
        assert "name: graphiti-pitfalls" in draft.content
        body = draft.content.split("---", 2)[2]
        assert "description:" not in body, "keys must not be stranded in the body"

    async def test_a_proper_block_is_left_alone(self, monkeypatch):
        async def fake(prompt):
            return "---\nname: a\ndescription: b\n---\n\nbody", "local"

        monkeypatch.setattr(distill, "_draft_with_local", fake)
        monkeypatch.setattr(distill.settings, "anthropic_api_key", None)

        draft = await draft_skill("Adyen", MEMORIES)
        assert draft.content == "---\nname: a\ndescription: b\n---\n\nbody"

    async def test_adds_frontmatter_when_the_model_forgets(self, monkeypatch):
        """A draft missing its header is still useful; throwing the work away is not."""

        async def fake(prompt):
            return "Use a 1-cent authorisation and void it.", "local"

        monkeypatch.setattr(distill, "_draft_with_local", fake)
        monkeypatch.setattr(distill.settings, "anthropic_api_key", None)

        draft = await draft_skill("Adyen", MEMORIES)

        assert draft.content.startswith("---\nname: adyen")
        assert "1-cent" in draft.content

    async def test_an_empty_draft_fails_loudly(self, monkeypatch):
        async def fake(prompt):
            return "   ", "local"

        monkeypatch.setattr(distill, "_draft_with_local", fake)
        monkeypatch.setattr(distill.settings, "anthropic_api_key", None)

        with pytest.raises(ValueError, match="empty draft"):
            await draft_skill("Adyen", MEMORIES)

    async def test_no_memories_is_refused(self):
        with pytest.raises(ValueError, match="No memories"):
            await draft_skill("Adyen", [])

    async def test_uses_anthropic_when_a_key_is_configured(self, monkeypatch):
        called = {}

        async def fake_anthropic(prompt):
            called["anthropic"] = True
            return "---\nname: a\n---\nbody", "claude-opus-5"

        async def fake_local(prompt):
            called["local"] = True
            return "x", "local"

        monkeypatch.setattr(distill, "_draft_with_anthropic", fake_anthropic)
        monkeypatch.setattr(distill, "_draft_with_local", fake_local)
        monkeypatch.setattr(distill.settings, "anthropic_api_key", "sk-ant-test")

        draft = await draft_skill("Adyen", MEMORIES)

        assert called == {"anthropic": True}
        assert draft.model == "claude-opus-5"

    async def test_the_prompt_carries_the_memories(self, monkeypatch):
        seen = {}

        async def fake(prompt):
            seen["prompt"] = prompt
            return "---\nname: a\n---\nbody", "local"

        monkeypatch.setattr(distill, "_draft_with_local", fake)
        monkeypatch.setattr(distill.settings, "anthropic_api_key", None)
        await draft_skill("Adyen", MEMORIES)

        assert "zero-amount authorisations" in seen["prompt"]
        assert "no upper bound" in seen["prompt"]

    async def test_a_long_memory_is_truncated_not_dropped(self, monkeypatch):
        seen = {}

        async def fake(prompt):
            seen["prompt"] = prompt
            return "---\nname: a\n---\nbody", "local"

        monkeypatch.setattr(distill, "_draft_with_local", fake)
        monkeypatch.setattr(distill.settings, "anthropic_api_key", None)
        await draft_skill("Adyen", [{"name": "big", "content": "x" * 10_000}])

        assert "x" * 100 in seen["prompt"]
        assert len(seen["prompt"]) < 5_000


class TestPeopleFiltering:
    """A teammate's name is always among the most-mentioned entities."""

    def test_an_email_excludes_the_person_every_way_they_appear(self):
        from drymem_server.discover import _names_from

        names = _names_from(["miguel.barrientos@ciudadela.eu"])

        assert "miguel" in names
        assert "barrientos" in names
        assert "miguel.barrientos" in names
        assert "miguel.barrientos@ciudadela.eu" in names

    def test_a_display_name_excludes_each_part(self):
        from drymem_server.discover import _names_from

        names = _names_from(["Jose Garcia"])
        assert {"jose", "garcia", "jose garcia"} <= names

    def test_short_fragments_are_not_excluded(self):
        """Excluding two-letter fragments would suppress real subjects."""
        from drymem_server.discover import _names_from

        assert "de" not in _names_from(["Ana de Souza"])

    def test_nothing_in_means_nothing_excluded(self):
        from drymem_server.discover import _names_from

        assert _names_from([]) == set()
        assert _names_from([""]) == set()
