"""
Two organisations that happen to track the same repository.

Every other isolation test gives the two tenants *different* project keys, which
is the easy case: the keys differ, so the Neo4j group ids differ, so nothing can
cross. This asks the harder question a hosted product has to answer — what
happens when Acme and Beta both have a project called
`github.com/acme/payments`, because both forked it or both depend on it.

The control plane scopes by `org_id` and refuses a project the caller is not a
member of. The graph does not see `org_id` at all.
"""

from __future__ import annotations

import pytest

from drymem_server.db.models import Project, ProjectMember
from tests.conftest import auth

SHARED_KEY = "github.com/acme/payments"


async def project_for_org(sessionmaker, org_id, owner_id, key: str) -> None:
    """Give an org a project with this key, and put `owner_id` on it."""
    async with sessionmaker() as session:
        project = Project(org_id=org_id, project_key=key)
        session.add(project)
        await session.flush()
        session.add(ProjectMember(project_id=project.id, user_id=owner_id, role="lead"))
        await session.commit()


async def both_orgs_same_key(client, sessionmaker) -> None:
    """Acme and Other each own a project at the same key, each with one member."""
    miguel_id, acme_id, _, _ = client.world["people"]["miguel"]
    outsider_id, other_id, _, _ = client.world["people"]["outsider"]

    await project_for_org(sessionmaker, acme_id, miguel_id, SHARED_KEY)
    await project_for_org(sessionmaker, other_id, outsider_id, SHARED_KEY)


@pytest.mark.asyncio
async def test_a_shared_memory_does_not_cross_between_orgs(client, sessionmaker):
    """The one that matters.

    Miguel writes a memory in Acme and shares it with his team. The outsider is
    a legitimate member of a *different* organisation's project that happens to
    carry the same key. He must not be able to read it.
    """
    saved = await client.post(
        "/v1/memories",
        headers=auth(client, "miguel"),
        json={
            "project_key": SHARED_KEY,
            "summary": "## Summary\nWe chose Adyen, and the contract rate is 1.2%.",
            "topic_key": "pay/provider",
            "type": "decision",
        },
    )
    assert saved.status_code == 200, saved.text
    await client.post(
        f"/v1/memories/{saved.json()['episode_uuid']}/promote", headers=auth(client, "miguel")
    )

    body = (
        await client.get(
            "/v1/memories/context",
            headers=auth(client, "outsider"),
            params={"project_key": SHARED_KEY},
        )
    ).json()

    titles = " ".join(e["content"] for e in body["episodes"])
    assert "Adyen" not in titles, "another organisation read a shared memory"
    assert body["episodes"] == []


@pytest.mark.asyncio
async def test_a_private_memory_does_not_cross_between_orgs(client, sessionmaker):
    """Private memories are keyed by user id as well, so this should hold even
    if the team group leaks — worth asserting separately so a fix to one is not
    mistaken for a fix to both."""
    await both_orgs_same_key(client, sessionmaker)

    await client.post(
        "/v1/memories",
        headers=auth(client, "miguel"),
        json={
            "project_key": SHARED_KEY,
            "summary": "## Summary\nThe staging password is hunter2.",
            "topic_key": "ops/staging",
        },
    )

    body = (
        await client.get(
            "/v1/memories/context",
            headers=auth(client, "outsider"),
            params={"project_key": SHARED_KEY},
        )
    ).json()
    assert body["episodes"] == []


@pytest.mark.asyncio
async def test_search_does_not_cross_between_orgs(client, sessionmaker):
    """Search reads the graph directly, so it is its own path to the same rows."""
    await both_orgs_same_key(client, sessionmaker)

    saved = await client.post(
        "/v1/memories",
        headers=auth(client, "miguel"),
        json={
            "project_key": SHARED_KEY,
            "summary": "## Summary\nAdyen was chosen for retries.",
            "topic_key": "pay/retry",
        },
    )
    await client.post(
        f"/v1/memories/{saved.json()['episode_uuid']}/promote", headers=auth(client, "miguel")
    )

    body = (
        await client.get(
            "/v1/memories/search",
            headers=auth(client, "outsider"),
            params={"project_key": SHARED_KEY, "q": "Adyen"},
        )
    ).json()
    assert body["memories"] == []
