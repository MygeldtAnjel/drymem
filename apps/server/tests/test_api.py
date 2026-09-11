"""
The HTTP surface, against a real Postgres.

Concentrated on the two things the API exists to guarantee: that a caller only
ever touches their own org's memories, and that nothing reaches storage without
passing the scrubber.
"""

from __future__ import annotations

import pytest

from tests.conftest import auth

pytestmark = pytest.mark.integration

PROJECT = "github.com/acme/payments"


async def save(client, who="miguel", **kwargs):
    body = {"project_key": PROJECT, "summary": "We switched payments to Adyen.", **kwargs}
    return await client.post("/v1/memories", json=body, headers=auth(client, who))


class TestAuthentication:
    async def test_no_token_is_401(self, client):
        assert (
            await client.post("/v1/memories", json={"project_key": PROJECT, "summary": "x"})
        ).status_code == 401

    async def test_a_garbage_token_is_401(self, client):
        r = await client.get(
            "/v1/projects", headers={"Authorization": "Bearer drymem_totally-made-up-value-here"}
        )
        assert r.status_code == 401

    async def test_a_revoked_token_is_401(self, client):
        assert (
            await client.get("/v1/projects", headers=auth(client, "revoked"))
        ).status_code == 401

    async def test_a_valid_token_works(self, client):
        assert (await client.get("/v1/projects", headers=auth(client))).status_code == 200

    async def test_the_401_does_not_say_which_kind_of_failure(self, client):
        """Revoked and unknown must be indistinguishable."""
        unknown = await client.get(
            "/v1/projects", headers={"Authorization": "Bearer drymem_aaaaaaaaaaaaaaaaaaaaaaaa"}
        )
        revoked = await client.get("/v1/projects", headers=auth(client, "revoked"))
        assert unknown.json() == revoked.json()


class TestTenantIsolation:
    async def test_another_org_cannot_see_your_project(self, client):
        await save(client, "miguel")

        r = await client.get("/v1/projects", headers=auth(client, "outsider"))
        assert r.status_code == 200
        assert r.json()["projects"] == []

    async def test_another_org_cannot_delete_your_memory_even_with_the_uuid(self, client, store):
        saved = (await save(client, "miguel")).json()

        r = await client.delete(
            f"/v1/memories/{saved['episode_uuid']}", headers=auth(client, "outsider")
        )

        assert r.status_code == 404, "a known uuid must not be enough to delete across orgs"
        assert store.deleted == [], "the graph must not have been touched"

    async def test_a_teammate_starts_with_their_own_project_view(self, client):
        """Step 2A is still private-by-default: Jose sees nothing of Miguel's yet."""
        await save(client, "miguel")

        r = await client.get("/v1/projects", headers=auth(client, "jose"))
        assert r.json()["projects"] == []

    async def test_you_can_delete_your_own(self, client, store):
        saved = (await save(client, "miguel")).json()

        r = await client.delete(f"/v1/memories/{saved['episode_uuid']}", headers=auth(client))

        assert r.status_code == 200 and r.json()["deleted"] is True
        assert store.deleted == [saved["episode_uuid"]]


class TestSaving:
    async def test_a_save_returns_what_was_extracted(self, client):
        body = (await save(client)).json()

        assert body["project_key"] == PROJECT
        assert body["author"] == "miguel@acme.test"
        assert body["entity_count"] == 2
        assert body["degraded"] is None

    async def test_the_project_is_created_on_first_save(self, client):
        await save(client)

        projects = (await client.get("/v1/projects", headers=auth(client))).json()["projects"]
        assert [p["project_key"] for p in projects] == [PROJECT]
        assert projects[0]["memory_count"] == 1

    async def test_a_topic_key_names_the_episode(self, client):
        assert (await save(client, topic_key="payments/provider")).json()[
            "name"
        ] == "payments/provider"

    async def test_without_a_topic_key_a_name_is_generated(self, client):
        assert (await save(client)).json()["name"].startswith("session-")

    async def test_an_empty_summary_is_rejected(self, client):
        r = await client.post(
            "/v1/memories", json={"project_key": PROJECT, "summary": ""}, headers=auth(client)
        )
        assert r.status_code == 422


class TestScrubbingOnTheWire:
    async def test_a_secret_never_reaches_the_store(self, client, store):
        r = await save(
            client,
            summary="Deployed with AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE and it worked.",
        )

        assert r.status_code == 200
        assert "AKIAIOSFODNN7EXAMPLE" not in store.saved_bodies[0]
        assert "[redacted:aws-key]" in store.saved_bodies[0]

    async def test_the_response_says_what_was_redacted(self, client):
        r = await save(client, summary="key AKIAIOSFODNN7EXAMPLE here")
        assert r.json()["scrubbed"] == "redacted 1x aws-key"

    async def test_a_clean_memory_reports_nothing_redacted(self, client):
        assert (await save(client)).json()["scrubbed"] == ""

    async def test_a_private_key_refuses_the_save_and_stores_nothing(self, client, store):
        r = await save(
            client,
            summary="deploy key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEvQ...\n-----END RSA PRIVATE KEY-----",
        )

        assert r.status_code == 422
        assert "Rotate the key" in r.json()["detail"]
        assert store.saved_bodies == [], "nothing may be stored when the save is refused"


class TestReading:
    async def test_context_returns_recent_episodes_with_their_author(self, client):
        await save(client, topic_key="payments/provider")

        r = await client.get(
            "/v1/memories/context", params={"project_key": PROJECT}, headers=auth(client)
        )

        episodes = r.json()["episodes"]
        assert len(episodes) == 1
        assert episodes[0]["name"] == "payments/provider"
        assert episodes[0]["author"] == "miguel@acme.test"
        assert episodes[0]["scope"] == "private"

    async def test_search_marks_superseded_facts(self, client, store):
        from datetime import UTC, datetime

        from drymem_server.memory_store import Fact

        store.facts = [
            Fact(name="uses", fact="payments uses Stripe", invalid_at=datetime.now(UTC)),
            Fact(name="uses", fact="payments uses Adyen"),
        ]

        results = (
            await client.get(
                "/v1/memories/search",
                params={"project_key": PROJECT, "q": "payments"},
                headers=auth(client),
            )
        ).json()["results"]

        assert [r["superseded"] for r in results] == [True, False]

    async def test_search_needs_a_query(self, client):
        r = await client.get(
            "/v1/memories/search", params={"project_key": PROJECT, "q": ""}, headers=auth(client)
        )
        assert r.status_code == 422


class TestUpdating:
    async def test_appending_keeps_the_original(self, client, store):
        await save(client, topic_key="payments/provider")

        r = await client.patch(
            "/v1/memories/payments/provider",
            json={"project_key": PROJECT, "update_summary": "Moved to Stripe."},
            headers=auth(client),
        )

        assert r.status_code == 200
        assert r.json()["name"].startswith("payments/provider/update-")
        assert store.deleted == []

    async def test_replacing_removes_the_prior_episodes(self, client, store):
        first = (await save(client, topic_key="payments/provider")).json()

        r = await client.patch(
            "/v1/memories/payments/provider",
            json={"project_key": PROJECT, "update_summary": "Moved to Stripe.", "replace": True},
            headers=auth(client),
        )

        assert r.json()["name"] == "payments/provider"
        assert first["episode_uuid"] in store.deleted


class TestHealth:
    async def test_health_needs_no_token(self, client):
        r = await client.get("/healthz")

        assert r.status_code == 200
        assert r.json()["postgres"] is True
        assert "extractor" in r.json()


class TestFeedback:
    """The pilot's precision metric. Wrong here means the 90% number is fiction."""

    async def test_a_thumb_is_recorded(self, client):
        saved = (await save(client)).json()

        r = await client.post(
            f"/v1/memories/{saved['episode_uuid']}/feedback",
            json={"rating": 1, "query": "payments"},
            headers=auth(client),
        )

        assert r.status_code == 200
        assert r.json()["rating"] == 1

    async def test_changing_your_mind_replaces_rather_than_adds(self, client):
        saved = (await save(client)).json()
        url = f"/v1/memories/{saved['episode_uuid']}/feedback"

        await client.post(url, json={"rating": 1, "query": "payments"}, headers=auth(client))
        await client.post(url, json={"rating": -1, "query": "payments"}, headers=auth(client))

        projects = (await client.get("/v1/projects", headers=auth(client))).json()["projects"]
        assert projects[0]["positive"] == 0
        assert projects[0]["negative"] == 1

    async def test_the_same_memory_can_be_rated_per_query(self, client):
        """Good for 'payments', useless for 'auth' — both are worth knowing."""
        saved = (await save(client)).json()
        url = f"/v1/memories/{saved['episode_uuid']}/feedback"

        await client.post(url, json={"rating": 1, "query": "payments"}, headers=auth(client))
        await client.post(url, json={"rating": -1, "query": "auth"}, headers=auth(client))

        projects = (await client.get("/v1/projects", headers=auth(client))).json()["projects"]
        assert projects[0]["positive"] == 1
        assert projects[0]["negative"] == 1

    async def test_memory_count_is_not_inflated_by_ratings(self, client):
        """The feedback join multiplies rows; the count must stay distinct."""
        saved = (await save(client)).json()
        url = f"/v1/memories/{saved['episode_uuid']}/feedback"

        await client.post(url, json={"rating": 1, "query": "a"}, headers=auth(client))
        await client.post(url, json={"rating": 1, "query": "b"}, headers=auth(client))

        projects = (await client.get("/v1/projects", headers=auth(client))).json()["projects"]
        assert projects[0]["memory_count"] == 1

    async def test_an_invalid_rating_is_rejected(self, client):
        saved = (await save(client)).json()

        r = await client.post(
            f"/v1/memories/{saved['episode_uuid']}/feedback",
            json={"rating": 5, "query": ""},
            headers=auth(client),
        )
        assert r.status_code == 422

    async def test_another_org_cannot_rate_your_memory(self, client):
        saved = (await save(client, "miguel")).json()

        r = await client.post(
            f"/v1/memories/{saved['episode_uuid']}/feedback",
            json={"rating": -1, "query": "x"},
            headers=auth(client, "outsider"),
        )
        assert r.status_code == 404

    async def test_rating_needs_a_token(self, client):
        saved = (await save(client)).json()

        r = await client.post(
            f"/v1/memories/{saved['episode_uuid']}/feedback", json={"rating": 1, "query": ""}
        )
        assert r.status_code == 401


class TestBackfill:
    """Episodes that predate the index must become visible, exactly once."""

    async def test_indexes_episodes_with_no_row(self, client, store, sessionmaker, monkeypatch):
        from sqlalchemy import select

        from drymem_server.admin import backfill
        from drymem_server.db.models import Memory, Org, User
        from drymem_server.identity import sanitize_group_id
        from drymem_server.memory_store import Metadata

        # Two episodes in the graph, nothing in the index — the migrated case.
        group = sanitize_group_id(PROJECT)
        for name in ("old/one", "old/two"):
            await store.save(
                name=name, body=f"# {name}\nbody", group_id=group, metadata=Metadata(PROJECT, "x")
            )

        async with sessionmaker() as session:
            org = Org(name="Acme2", slug="acme2")
            session.add(org)
            await session.flush()
            session.add(User(org_id=org.id, email="backfill@acme.test"))
            await session.commit()

        import drymem_server.memory_store as ms
        from drymem_server import admin

        # monkeypatch, not assignment: a bare assignment here leaked into the
        # extraction tests and broke them.
        monkeypatch.setattr(admin, "sessionmaker_for", lambda _url: sessionmaker)
        monkeypatch.setattr(ms, "GraphitiMemoryStore", lambda: store)

        assert await backfill(PROJECT, "backfill@acme.test") == 0
        assert await backfill(PROJECT, "backfill@acme.test") == 0  # idempotent

        async with sessionmaker() as session:
            rows = (await session.execute(select(Memory))).scalars().all()

        assert len(rows) == 2, "a second run must not duplicate"
        assert {r.title for r in rows} == {"old/one", "old/two"}
