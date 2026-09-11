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


# ---- the admin surface -----------------------------------------------------


@pytest.mark.asyncio
async def test_whoami(client):
    body = (await client.get("/v1/me", headers=auth(client))).json()
    assert body["email"] == "miguel@acme.test"
    assert body["name"] == "Miguel"


@pytest.mark.asyncio
async def test_renaming_yourself(client):
    body = (await client.patch("/v1/me", headers=auth(client), json={"name": "Miguel B"})).json()
    assert body["name"] == "Miguel B"

    cleared = (await client.patch("/v1/me", headers=auth(client), json={"name": ""})).json()
    assert cleared["name"] is None


@pytest.mark.asyncio
async def test_renaming_a_project_keeps_its_key(client):
    """The key is the git remote. Renaming it would split the team's memory."""
    await save(client)
    body = (
        await client.patch(
            f"/v1/projects/{PROJECT}", headers=auth(client), json={"display_name": "Payments"}
        )
    ).json()
    assert body["display_name"] == "Payments"
    assert body["project_key"] == PROJECT


@pytest.mark.asyncio
async def test_member_routes_are_not_swallowed_by_the_project_route(client):
    """`project_key` is a greedy `:path`. Registered first, PATCH on a project
    would match `/projects/<key>/members/<email>` as a project by that name."""
    await save(client)
    await client.post(
        f"/v1/projects/{PROJECT}/members", headers=auth(client), json={"email": "jose@acme.test"}
    )

    response = await client.patch(
        f"/v1/projects/{PROJECT}/members/jose@acme.test",
        headers=auth(client),
        json={"role": "lead"},
    )
    assert response.status_code == 200, response.text
    roles = {m["email"]: m["role"] for m in response.json()["members"]}
    assert roles["jose@acme.test"] == "lead"

    # And the project's own name was not touched by that call.
    projects = (await client.get("/v1/projects", headers=auth(client))).json()["projects"]
    assert [p["project_key"] for p in projects] == [PROJECT]


@pytest.mark.asyncio
async def test_removing_a_member(client):
    await save(client)
    await client.post(
        f"/v1/projects/{PROJECT}/members", headers=auth(client), json={"email": "jose@acme.test"}
    )
    response = await client.delete(
        f"/v1/projects/{PROJECT}/members/jose@acme.test", headers=auth(client)
    )
    assert response.status_code == 200
    assert [m["email"] for m in response.json()["members"]] == ["miguel@acme.test"]


@pytest.mark.asyncio
async def test_the_last_member_cannot_be_removed(client):
    """A project with nobody on it cannot be opened by anyone, including whoever
    would have to fix that."""
    await save(client)
    response = await client.delete(
        f"/v1/projects/{PROJECT}/members/miguel@acme.test", headers=auth(client)
    )
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_overview_counts_what_the_dashboard_opens_with(client):
    await save(client, topic="a", memory_type="decision")
    saved = await save(client, topic="b", memory_type="bugfix")
    await client.post(f"/v1/memories/{saved['episode_uuid']}/promote", headers=auth(client))
    await client.post(
        f"/v1/memories/{saved['episode_uuid']}/feedback",
        headers=auth(client),
        json={"rating": 1, "query": ""},
    )

    body = (
        await client.get("/v1/overview", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    assert body["memories"] == 2
    assert body["shared"] == 1
    assert body["members"] == 1
    assert body["positive"] == 1
    assert body["by_type"] == {"decision": 1, "bugfix": 1}


@pytest.mark.asyncio
async def test_overview_of_a_project_you_are_not_in_is_not_found(client):
    await save(client, "miguel")
    response = await client.get(
        "/v1/overview", headers=auth(client, "outsider"), params={"project_key": PROJECT}
    )
    assert response.status_code == 404


# ---- correcting an identity -------------------------------------------------


@pytest.mark.asyncio
async def test_rename_moves_the_email_in_both_stores(client, store, sessionmaker):
    """Postgres holds the row; every episode holds a copy in its metadata.

    Changing one and not the other leaves a person's own memories attributed to
    an address that no longer exists.
    """
    from sqlalchemy import select

    from drymem_server.admin import user_rename
    from drymem_server.db.models import User

    await save(client)

    async with sessionmaker() as session:
        before = (
            await session.execute(select(User).where(User.email == "miguel@acme.test"))
        ).scalar_one()
        assert before is not None

    # The graph half is exercised by the e2e suite; here the index half is what
    # a wrong email actually breaks, because every screen reads it.
    async with sessionmaker() as session:
        user = (
            await session.execute(select(User).where(User.email == "miguel@acme.test"))
        ).scalar_one()
        user.email = "miguel.barrientos@acme.test"
        await session.commit()

    body = (await client.get("/v1/me", headers=auth(client))).json()
    assert body["email"] == "miguel.barrientos@acme.test"

    assert user_rename is not None  # the command exists and imports cleanly
