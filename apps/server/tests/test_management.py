"""
The management surface: sessions, people, skills — and the shape a memory now has.

These run against a real Postgres because the whole point of them is the joins:
"which memories came out of one sitting" and "who is in this org" are index
questions, and a fake index would prove nothing.
"""

from __future__ import annotations

import pytest

from tests.conftest import auth

PROJECT = "github.com/acme/payments"


async def save(
    client,
    who="miguel",
    *,
    summary="## Summary\nwork\n\n## Learned\nthings",
    topic="work/one",
    memory_type="bugfix",
    session_id="s-1",
):
    response = await client.post(
        "/v1/memories",
        headers=auth(client, who),
        json={
            "project_key": PROJECT,
            "summary": summary,
            "topic_key": topic,
            "type": memory_type,
            "session_id": session_id,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


# ---- the shape a memory has ------------------------------------------------


@pytest.mark.asyncio
async def test_saved_memory_comes_back_with_its_type_and_session(client):
    await save(client, memory_type="decision", session_id="s-abc")

    body = (
        await client.get(
            "/v1/memories/context", headers=auth(client), params={"project_key": PROJECT}
        )
    ).json()
    [episode] = body["episodes"]
    assert episode["type"] == "decision"
    assert episode["session_id"] == "s-abc"
    assert episode["topic_key"] == "work/one"
    assert episode["rating"] is None


@pytest.mark.asyncio
async def test_an_unknown_type_becomes_note_rather_than_failing(client):
    """Losing a memory over a taxonomy label would be the wrong trade."""
    await save(client, memory_type="whatever-the-agent-invented")
    body = (
        await client.get(
            "/v1/memories/context", headers=auth(client), params={"project_key": PROJECT}
        )
    ).json()
    assert body["episodes"][0]["type"] == "note"


@pytest.mark.asyncio
async def test_the_title_is_what_a_person_wrote_not_the_topic_key(client):
    await save(client, summary="# Payments retry backoff\n\nbody", topic="pay/retry")
    body = (
        await client.get(
            "/v1/memories/context", headers=auth(client), params={"project_key": PROJECT}
        )
    ).json()
    episode = body["episodes"][0]
    assert episode["name"] == "pay/retry"
    assert episode["title"] == "Payments retry backoff"


@pytest.mark.asyncio
async def test_a_rating_rides_along_with_the_entry(client):
    saved = await save(client)
    await client.post(
        f"/v1/memories/{saved['episode_uuid']}/feedback",
        headers=auth(client),
        json={"rating": 1, "query": "retry"},
    )
    body = (
        await client.get(
            "/v1/memories/context", headers=auth(client), params={"project_key": PROJECT}
        )
    ).json()
    assert body["episodes"][0]["rating"] == 1


@pytest.mark.asyncio
async def test_the_schema_endpoint_describes_the_shape(client):
    body = (await client.get("/v1/memories/schema", headers=auth(client))).json()
    assert {t["name"] for t in body["types"]} >= {"decision", "bugfix", "note"}
    assert body["sections"][0] == "Summary"
    assert "## Learned" in body["template"]


# ---- promotion no longer shows the memory twice ----------------------------


@pytest.mark.asyncio
async def test_a_promoted_memory_appears_once_not_twice(client):
    """Promotion copies the episode; the author reads both groups.

    Before the dedupe this returned two identical entries and spent the
    session-start budget saying the same thing twice.
    """
    saved = await save(client)
    await client.post(f"/v1/memories/{saved['episode_uuid']}/promote", headers=auth(client))

    body = (
        await client.get(
            "/v1/memories/context", headers=auth(client), params={"project_key": PROJECT}
        )
    ).json()
    assert len(body["episodes"]) == 1
    assert body["episodes"][0]["scope"] == "team"
    assert body["episodes"][0]["promoted_at"] is not None


@pytest.mark.asyncio
async def test_deleting_a_shared_memory_removes_the_shared_copy_too(client, store):
    """Otherwise the team keeps reading a memory its author believes is gone."""
    saved = await save(client)
    await client.post(f"/v1/memories/{saved['episode_uuid']}/promote", headers=auth(client))

    response = await client.delete(f"/v1/memories/{saved['episode_uuid']}", headers=auth(client))
    assert response.status_code == 200
    assert all(not episodes for episodes in store.episodes.values())


# ---- sessions --------------------------------------------------------------


@pytest.mark.asyncio
async def test_memories_from_one_sitting_group_into_one_session(client):
    await save(client, topic="a", session_id="s-xyz")
    await save(client, topic="b", session_id="s-xyz")
    await save(client, topic="c", session_id="s-other")

    body = (
        await client.get("/v1/sessions", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    by_id = {s["session_id"]: s for s in body["sessions"]}
    assert by_id["s-xyz"]["memory_count"] == 2
    assert by_id["s-other"]["memory_count"] == 1
    assert by_id["s-xyz"]["synthetic"] is False


@pytest.mark.asyncio
async def test_a_memory_with_no_session_is_grouped_by_day_and_says_so(client):
    """A guessed session id would be indistinguishable from a recorded one."""
    await save(client, topic="old", session_id="")
    body = (
        await client.get("/v1/sessions", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    [session] = body["sessions"]
    assert session["synthetic"] is True
    assert session["author"] == "miguel@acme.test"


@pytest.mark.asyncio
async def test_sessions_of_a_project_you_are_not_in_are_invisible(client):
    await save(client, "miguel")
    body = (
        await client.get(
            "/v1/sessions", headers=auth(client, "outsider"), params={"project_key": PROJECT}
        )
    ).json()
    assert body["sessions"] == []


# ---- people ----------------------------------------------------------------


@pytest.mark.asyncio
async def test_users_lists_this_org_only(client):
    body = (await client.get("/v1/users", headers=auth(client))).json()
    emails = {u["email"] for u in body["users"]}
    assert emails == {"miguel@acme.test", "jose@acme.test"}


@pytest.mark.asyncio
async def test_users_counts_what_someone_contributed(client):
    await save(client, "miguel", topic="a")
    await save(client, "miguel", topic="b")
    body = (await client.get("/v1/users", headers=auth(client))).json()
    miguel = next(u for u in body["users"] if u["email"] == "miguel@acme.test")
    assert miguel["memory_count"] == 2
    assert miguel["project_count"] == 1


# ---- skills ----------------------------------------------------------------


async def publish(client, who="miguel", *, name="retry-backoff", content="# Retry\nrules"):
    return await client.post(
        "/v1/skills",
        headers=auth(client, who),
        json={
            "project_key": PROJECT,
            "name": name,
            "topic": "retry",
            "content": content,
            "model": "claude-opus-5",
            "memory_count": 4,
        },
    )


@pytest.mark.asyncio
async def test_publishing_a_skill_makes_it_readable_by_the_project(client):
    await save(client)
    assert (await publish(client)).status_code == 200

    body = (
        await client.get("/v1/skills", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    [skill] = body["skills"]
    assert skill["name"] == "retry-backoff"
    assert skill["author"] == "miguel@acme.test"
    assert skill["memory_count"] == 4


@pytest.mark.asyncio
async def test_republishing_replaces_rather_than_duplicating(client):
    """Two answers to one subject is the state the product exists to prevent."""
    await save(client)
    await publish(client, content="first")
    await publish(client, content="second")

    body = (
        await client.get("/v1/skills", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    assert len(body["skills"]) == 1
    assert body["skills"][0]["content"] == "second"


@pytest.mark.asyncio
async def test_a_skill_is_scrubbed_like_a_memory(client):
    """A skill is written from memories and pasted into repos; same exposure."""
    await save(client)
    await publish(
        client, content="run with AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
    )

    body = (
        await client.get("/v1/skills", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    assert "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" not in body["skills"][0]["content"]


@pytest.mark.asyncio
async def test_publishing_into_a_project_you_are_not_in_is_not_found(client):
    await save(client, "miguel")
    assert (await publish(client, "outsider")).status_code == 404


@pytest.mark.asyncio
async def test_deleting_a_skill(client):
    await save(client)
    await publish(client)
    response = await client.delete(
        "/v1/skills/retry-backoff", headers=auth(client), params={"project_key": PROJECT}
    )
    assert response.status_code == 200

    body = (
        await client.get("/v1/skills", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    assert body["skills"] == []
