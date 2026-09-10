"""
The five MCP tools, against a fake store.

No Neo4j and no model: these assert on what drymem does with a result, never on
what an LLM extracted. The extraction is exercised by the e2e test instead.
"""

from __future__ import annotations

import subprocess
from datetime import UTC, datetime

import pytest

from drymem_server import server
from drymem_server.memory_store import Episode, Fact, Metadata, SaveResult


class FakeStore:
    def __init__(self):
        self.saved: list[dict] = []
        self.deleted: list[str] = []
        self.episodes: list[Episode] = []
        self.facts: list[Fact] = []

    async def save(self, *, name, body, group_id, metadata) -> SaveResult:
        self.saved.append({"name": name, "body": body, "group_id": group_id, "metadata": metadata})
        return SaveResult(uuid=f"uuid-{len(self.saved)}", entity_count=3, edge_count=2)

    async def search(self, *, query, group_ids, limit) -> list[Fact]:
        return self.facts[:limit]

    async def recent(self, *, group_ids, limit) -> list[Episode]:
        return self.episodes[:limit]

    async def delete(self, episode_id: str) -> None:
        self.deleted.append(episode_id)


@pytest.fixture
def store(monkeypatch):
    fake = FakeStore()
    monkeypatch.setattr(server, "store", fake)
    return fake


@pytest.fixture
def project(tmp_path):
    repo = tmp_path / "proj"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(
        ["git", "remote", "add", "origin", "git@github.com:acme/proj.git"], cwd=repo, check=True
    )
    subprocess.run(["git", "config", "user.email", "miguel@ciudadela.eu"], cwd=repo, check=True)
    return str(repo)


class TestFinalizeSession:
    async def test_saves_with_the_topic_key_as_the_name(self, store, project):
        await server.mem_finalize_session(project, "we fixed it", topic_key="auth/jwt")
        assert store.saved[0]["name"] == "auth/jwt"

    async def test_generates_a_name_when_no_topic_key(self, store, project):
        await server.mem_finalize_session(project, "we fixed it")
        assert store.saved[0]["name"].startswith("session-")

    async def test_attaches_project_and_author(self, store, project):
        await server.mem_finalize_session(project, "we fixed it")
        meta: Metadata = store.saved[0]["metadata"]

        assert meta.project_key == "github.com/acme/proj"
        assert meta.author == "miguel@ciudadela.eu"
        assert meta.scope == "private"
        assert meta.tool == "claude-code"

    async def test_group_id_comes_from_the_remote_not_the_path(self, store, project):
        await server.mem_finalize_session(project, "we fixed it")
        assert store.saved[0]["group_id"] == "github-com-acme-proj"

    async def test_reports_what_was_extracted(self, store, project):
        out = await server.mem_finalize_session(project, "we fixed it")
        assert "entities extracted: 3" in out
        assert "uuid-1" in out


class TestSearch:
    async def test_says_so_when_nothing_matches(self, store, project):
        assert await server.mem_search(project, "auth") == "No memories found."

    async def test_renders_facts(self, store, project):
        store.facts = [Fact(name="uses", fact="payments uses Adyen", created_at=datetime.now(UTC))]
        out = await server.mem_search(project, "payments")

        assert "payments uses Adyen" in out
        assert "Found 1 result(s)" in out

    async def test_marks_superseded_facts(self, store, project):
        store.facts = [Fact(name="uses", fact="payments uses Stripe", invalid_at=datetime.now(UTC))]
        assert "[superseded]" in await server.mem_search(project, "payments")


class TestContext:
    async def test_says_so_when_empty(self, store, project):
        assert await server.mem_context(project) == "No recent context."

    async def test_shows_the_author_of_each_episode(self, store, project):
        store.episodes = [
            Episode(
                uuid="u1",
                name="auth/jwt",
                content="the body",
                created_at=datetime.now(UTC),
                metadata=Metadata(project_key="github.com/acme/proj", author="jose@ciudadela.eu"),
            )
        ]
        out = await server.mem_context(project)

        assert "auth/jwt" in out
        assert "jose@ciudadela.eu" in out

    async def test_survives_an_episode_with_no_metadata(self, store, project):
        store.episodes = [Episode(uuid="u1", name="old", content="pre-metadata episode")]
        assert "old" in await server.mem_context(project)


class TestUpdate:
    async def test_appending_suffixes_the_topic_key(self, store, project):
        await server.mem_update(project, "auth/jwt", "new finding")
        assert store.saved[0]["name"].startswith("auth/jwt/update-")

    async def test_replacing_reuses_the_topic_key(self, store, project):
        store.episodes = [Episode(uuid="old-1", name="auth/jwt", content="x")]
        await server.mem_update(project, "auth/jwt", "corrected", replace=True)

        assert store.saved[0]["name"] == "auth/jwt"
        assert store.deleted == ["old-1"]

    async def test_replacing_removes_prior_updates_too(self, store, project):
        store.episodes = [
            Episode(uuid="old-1", name="auth/jwt", content="x"),
            Episode(uuid="old-2", name="auth/jwt/update-20260101T000000", content="y"),
            Episode(uuid="other", name="db/migration", content="z"),
        ]
        await server.mem_update(project, "auth/jwt", "corrected", replace=True)

        assert store.deleted == ["old-1", "old-2"], "must not delete unrelated episodes"

    async def test_appending_deletes_nothing(self, store, project):
        store.episodes = [Episode(uuid="old-1", name="auth/jwt", content="x")]
        await server.mem_update(project, "auth/jwt", "more")

        assert store.deleted == []


class TestDelete:
    async def test_deletes_by_uuid(self, store, project):
        out = await server.mem_delete(project, "uuid-9")

        assert store.deleted == ["uuid-9"]
        assert "deleted" in out

    async def test_a_failure_is_reported_not_raised(self, store, project, monkeypatch):
        async def boom(episode_id):
            raise RuntimeError("neo4j is down")

        monkeypatch.setattr(store, "delete", boom)
        out = await server.mem_delete(project, "uuid-9")

        assert "Failed to delete" in out and "neo4j is down" in out
