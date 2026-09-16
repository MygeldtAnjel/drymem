"""
Tenant isolation, against real Neo4j.

`tests/test_tenancy.py` asks the same question of the service, but through
`InMemoryStore` — a double written beside the code it verifies, which is how a
cross-tenant leak survived until Step 4. This asks Neo4j directly: given two
group ids, does a read scoped to one ever return the other's rows?

Every read path is covered separately, because they are three different queries
and a `group_ids` filter forgotten in any one of them is the whole bug:
`recent` (Graphiti's episode fetch), `search_episodes` (the fulltext index) and
`search` (the fact edges).

Run with:  DRYMEM_E2E=1 uv run pytest -m e2e tests/test_e2e_tenancy.py
Skipped by default — needs `docker compose up` and Ollama serving.
"""

from __future__ import annotations

import os
import uuid

import pytest

from drymem_server.identity import group_id_team
from drymem_server.memory_store import GraphitiMemoryStore, Metadata

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio]

SKIP = not os.getenv("DRYMEM_E2E")
pytestmark.append(pytest.mark.skipif(SKIP, reason="set DRYMEM_E2E=1 to run"))

# The case the whole scoping exists for: one git remote, two companies.
SHARED_KEY = "github.com/acme/payments"


@pytest.fixture
async def store():
    return GraphitiMemoryStore()


@pytest.fixture
def two_orgs():
    """Two organisations' team groups for the *same* project key.

    Unique org ids per run so the test never touches real memories, and so a
    failed run leaves nothing that a later one would read.
    """
    acme = uuid.uuid4()
    beta = uuid.uuid4()
    return group_id_team(acme, SHARED_KEY), group_id_team(beta, SHARED_KEY)


def meta(author: str) -> Metadata:
    return Metadata(project_key=SHARED_KEY, author=author)


async def test_the_two_orgs_do_not_share_a_group_id(two_orgs):
    """Cheap, and it is the premise everything below rests on."""
    acme, beta = two_orgs
    assert acme != beta


async def test_recent_never_returns_another_orgs_episode(store, two_orgs):
    acme, beta = two_orgs
    await store.save(
        name="pay/provider",
        body="Acme authorises card charges through Adyen at 1.2%.",
        group_id=acme,
        metadata=meta("miguel@acme.test"),
    )
    await store.save(
        name="pay/provider",
        body="Beta authorises card charges through Stripe at 1.9%.",
        group_id=beta,
        metadata=meta("someone@beta.test"),
    )

    theirs = await store.recent(group_ids=[beta], limit=50)
    bodies = " ".join(e.content for e in theirs)
    assert "Adyen" not in bodies, "Beta read Acme's episode"
    assert "Stripe" in bodies, "Beta could not read its own"


async def test_the_fulltext_index_is_scoped_too(store, two_orgs):
    """A different query from `recent`, so a different place to forget the filter."""
    acme, beta = two_orgs
    await store.save(
        name="pay/provider",
        body="Acme authorises card charges through Adyen at 1.2%.",
        group_id=acme,
        metadata=meta("miguel@acme.test"),
    )

    found = await store.search_episodes(query="Adyen", group_ids=[beta], limit=20)
    assert found == [], "the fulltext index returned another org's episode"

    mine = await store.search_episodes(query="Adyen", group_ids=[acme], limit=20)
    assert mine, "the index did not return the org's own episode"


async def test_facts_are_scoped_too(store, two_orgs):
    """Extraction writes edges, and an edge is its own path to the same content."""
    acme, beta = two_orgs
    await store.save(
        name="pay/provider",
        body="Acme authorises card charges through Adyen at 1.2%.",
        group_id=acme,
        metadata=meta("miguel@acme.test"),
    )

    facts = await store.search(query="Adyen", group_ids=[beta], limit=20)
    assert facts == [], "a fact edge crossed between organisations"


async def test_asking_for_both_groups_returns_both(store, two_orgs):
    """The control: scoping must be a filter, not a coincidence of empty data."""
    acme, beta = two_orgs
    await store.save(
        name="pay/a", body="Acme chose Adyen.", group_id=acme, metadata=meta("m@acme.test")
    )
    await store.save(
        name="pay/b", body="Beta chose Stripe.", group_id=beta, metadata=meta("s@beta.test")
    )

    both = await store.recent(group_ids=[acme, beta], limit=50)
    bodies = " ".join(e.content for e in both)
    assert "Adyen" in bodies and "Stripe" in bodies
