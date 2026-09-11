"""
Extractor selection, and the promise that a broken extractor never loses a memory.
"""

from __future__ import annotations

import pytest

from drymem_server import extraction
from drymem_server.extraction import ANTHROPIC, FAKE, OLLAMA, StubLLMClient, build_llm_client


class TestSelection:
    def test_fake_needs_nothing(self):
        assert isinstance(build_llm_client(FAKE), StubLLMClient)

    def test_ollama_is_the_default(self, monkeypatch):
        monkeypatch.setattr(extraction.settings, "drymem_extractor", OLLAMA)
        assert not isinstance(build_llm_client(), StubLLMClient)

    def test_an_unknown_extractor_says_what_is_valid(self):
        with pytest.raises(ValueError, match="ollama"):
            build_llm_client("gpt5-please")

    def test_anthropic_without_a_key_fails_clearly(self, monkeypatch):
        monkeypatch.setattr(extraction.settings, "anthropic_api_key", None)
        with pytest.raises(ValueError, match="ANTHROPIC_API_KEY"):
            build_llm_client(ANTHROPIC)

    def test_anthropic_with_a_key_builds(self, monkeypatch):
        monkeypatch.setattr(extraction.settings, "anthropic_api_key", "sk-ant-test")
        assert build_llm_client(ANTHROPIC) is not None


class TestStubClient:
    async def test_returns_an_empty_result_matching_the_schema(self):
        from pydantic import BaseModel

        class Extracted(BaseModel):
            entities: list[str] = []
            summary: str = ""
            count: int = 0
            done: bool = False

        out = await StubLLMClient().generate_response([], response_model=Extracted)

        assert Extracted(**out).entities == []
        assert out == {"entities": [], "summary": "", "count": 0, "done": False}

    async def test_with_no_schema_returns_nothing(self):
        assert await StubLLMClient().generate_response([]) == {}


class TestDegradedSave:
    """If extraction dies, the memory must survive without it."""

    async def test_a_failing_extractor_still_stores_the_episode(self, monkeypatch):
        from drymem_server.memory_store import GraphitiMemoryStore, Metadata

        store = GraphitiMemoryStore()
        saved: dict = {}

        class BrokenGraphiti:
            driver = object()

            async def add_episode(self, **kwargs):
                raise RuntimeError("ollama is not running")

        async def fake_graphiti():
            return BrokenGraphiti()

        async def fake_episode_only(name, body, group_id, metadata, exc):
            from drymem_server.memory_store import SaveResult

            saved.update(name=name, body=body, exc=str(exc))
            return SaveResult(uuid="fallback-uuid", entity_count=0, edge_count=0, degraded=str(exc))

        monkeypatch.setattr(store, "_graphiti", fake_graphiti)
        monkeypatch.setattr(store, "_save_episode_only", fake_episode_only)

        result = await store.save(
            name="topic", body="the summary", group_id="g", metadata=Metadata("k", "a")
        )

        assert result.uuid == "fallback-uuid", "the memory must still be stored"
        assert result.degraded and "ollama is not running" in result.degraded
        assert saved["body"] == "the summary", "the author's text must survive verbatim"


def test_env_lookup_does_not_assume_a_repo_layout():
    """The container crashed on import because this counted parent directories.

    `drymem_server` sits 3 levels below the repo root in the monorepo, at the
    filesystem root in the image, and elsewhere again when pip-installed.
    """
    from drymem_server.settings import find_env_file

    found = find_env_file()
    assert found is None or found.name == ".env"


class TestCrossEncoder:
    """Graphiti's default reranker points at api.openai.com. Ours must not."""

    def test_is_pinned_to_the_local_endpoint(self, monkeypatch):
        from drymem_server.extraction import build_cross_encoder

        monkeypatch.setattr(extraction.settings, "local_llm_url", "http://localhost:11434/v1")
        encoder = build_cross_encoder()

        assert "localhost:11434" in str(encoder.client.base_url)
        assert "api.openai.com" not in str(encoder.client.base_url)

    def test_does_not_need_an_openai_key(self, monkeypatch):
        """The server must start with no OPENAI_API_KEY anywhere."""
        from drymem_server.extraction import build_cross_encoder

        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        assert build_cross_encoder() is not None
