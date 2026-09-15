"""
What the engine still owns: the shape of a memory, and the sittings they came
out of.

People, projects, members, skills and the audit trail moved to the control
plane when it took over identity; their tests moved with them, to
`apps/api/test`. What is left here needs a real Postgres, because the point of
it is the joins — "which memories came out of one sitting" is an index
question, and a fake index would prove nothing.
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
async def test_a_teammates_private_memory_is_not_in_the_sessions_list(client, sessionmaker):
    """The list showed every memory in the project, titles and all.

    Everywhere else in drymem a teammate's private memory is invisible; this
    table was reading straight from `project_id` with no scope clause, so Jose
    could read the titles of everything Miguel had kept to himself.
    """
    from tests.conftest import add_member

    await save(client, "miguel", summary="## Summary\nThe admin password is hunter2")
    await add_member(sessionmaker, PROJECT, client.world["people"]["jose"][0])

    body = (
        await client.get(
            "/v1/sessions", headers=auth(client, "jose"), params={"project_key": PROJECT}
        )
    ).json()
    assert [t for s in body["sessions"] for t in s["titles"]] == []


@pytest.mark.asyncio
async def test_a_session_opens_the_memories_it_produced(client):
    """The table was a dead end: five columns and nowhere to click."""
    await save(client, topic="a", session_id="s-open")
    await save(client, topic="b", session_id="s-open")
    await save(client, topic="elsewhere", session_id="s-other")

    body = (
        await client.get(
            "/v1/sessions/s-open", headers=auth(client), params={"project_key": PROJECT}
        )
    ).json()
    assert body["session"]["memory_count"] == 2
    assert len(body["memories"]) == 2
    assert {m["topic_key"] for m in body["memories"]} == {"a", "b"}
    # Every row links to the memory's own page, so the uuid has to be real.
    assert all(m["uuid"] for m in body["memories"])


@pytest.mark.asyncio
async def test_a_sessions_count_and_its_list_cannot_disagree(client):
    """Both read the same rows: a row saying 2 that opens 1 is a bug report."""
    await save(client, topic="a", session_id="s-count")
    await save(client, topic="b", session_id="s-count")

    listed = (
        await client.get("/v1/sessions", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    summary = next(s for s in listed["sessions"] if s["session_id"] == "s-count")
    opened = (
        await client.get(
            "/v1/sessions/s-count", headers=auth(client), params={"project_key": PROJECT}
        )
    ).json()
    assert summary["memory_count"] == len(opened["memories"])


@pytest.mark.asyncio
async def test_a_grouped_by_day_session_opens_too(client):
    """Its id is `email@day`, which has to survive being a path segment."""
    await save(client, topic="old", session_id="")
    listed = (
        await client.get("/v1/sessions", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    [session] = listed["sessions"]

    opened = await client.get(
        f"/v1/sessions/{session['session_id']}",
        headers=auth(client),
        params={"project_key": PROJECT},
    )
    assert opened.status_code == 200, opened.text
    assert len(opened.json()["memories"]) == 1


@pytest.mark.asyncio
async def test_opening_a_teammates_private_session_is_a_404(client, sessionmaker):
    from tests.conftest import add_member

    await save(client, "miguel", session_id="s-mine")
    await add_member(sessionmaker, PROJECT, client.world["people"]["jose"][0])

    response = await client.get(
        "/v1/sessions/s-mine", headers=auth(client, "jose"), params={"project_key": PROJECT}
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_sessions_of_a_project_you_are_not_in_are_invisible(client):
    await save(client, "miguel")
    body = (
        await client.get(
            "/v1/sessions", headers=auth(client, "outsider"), params={"project_key": PROJECT}
        )
    ).json()
    assert body["sessions"] == []


# ---- paging ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_sessions_page_with_a_cursor_and_say_when_they_end(client):
    """A project accumulates sittings forever; the cap used to be the whole story."""
    for i in range(5):
        await save(client, topic=f"page/{i}", session_id=f"s-page-{i}")

    first = (
        await client.get(
            "/v1/sessions", headers=auth(client), params={"project_key": PROJECT, "limit": 2}
        )
    ).json()
    assert len(first["sessions"]) == 2
    assert first["next_before"] is not None

    second = (
        await client.get(
            "/v1/sessions",
            headers=auth(client),
            params={"project_key": PROJECT, "limit": 2, "before": first["next_before"]},
        )
    ).json()
    assert len(second["sessions"]) == 2
    # No overlap: a cursor that returned the same rows would loop forever.
    assert {s["session_id"] for s in first["sessions"]}.isdisjoint(
        {s["session_id"] for s in second["sessions"]}
    )

    # Walking to the end terminates, and the last page says so.
    seen, cursor = set(), None
    for _ in range(10):
        params = {"project_key": PROJECT, "limit": 2}
        if cursor:
            params["before"] = cursor
        body = (await client.get("/v1/sessions", headers=auth(client), params=params)).json()
        seen.update(s["session_id"] for s in body["sessions"])
        cursor = body["next_before"]
        if cursor is None:
            break
    assert cursor is None
    assert len(seen) == 5


@pytest.mark.asyncio
async def test_memories_page_newest_first_without_repeating_one(client):
    for i in range(5):
        await save(client, topic=f"mem/{i}", session_id="s-mem")

    seen: list[str] = []
    cursor: tuple[str, str] | None = None
    for _ in range(10):
        params = {"project_key": PROJECT, "limit": 2, "order": "recent"}
        if cursor:
            # Both halves, as a real client sends them. The store's time filter
            # is inclusive, so a timestamp on its own returns the boundary item
            # twice — which is exactly what it did against real data.
            params["before"], params["before_uuid"] = cursor
        body = (
            await client.get("/v1/memories/context", headers=auth(client), params=params)
        ).json()
        seen.extend(e["uuid"] for e in body["episodes"])
        cursor = (
            (body["next_before"], body["next_uuid"]) if body["next_before"] else None
        )
        if cursor is None:
            break

    assert cursor is None
    assert len(seen) == len(set(seen)) == 5


@pytest.mark.asyncio
async def test_the_memory_on_a_page_boundary_is_not_served_twice(client):
    """The bug real data found and the in-memory double had hidden.

    Graphiti's `reference_time` is inclusive, so "older than the last one I
    saw" hands that one back. One duplicate per boundary, every time.
    """
    for i in range(4):
        await save(client, topic=f"edge/{i}", session_id="s-edge")

    first = (
        await client.get(
            "/v1/memories/context",
            headers=auth(client),
            params={"project_key": PROJECT, "limit": 2, "order": "recent"},
        )
    ).json()
    second = (
        await client.get(
            "/v1/memories/context",
            headers=auth(client),
            params={
                "project_key": PROJECT,
                "limit": 2,
                "order": "recent",
                "before": first["next_before"],
                "before_uuid": first["next_uuid"],
            },
        )
    ).json()

    last_of_first = first["episodes"][-1]["uuid"]
    assert last_of_first not in {e["uuid"] for e in second["episodes"]}
    assert len(second["episodes"]) == 2
