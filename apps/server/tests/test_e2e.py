"""
End to end, against real Neo4j and a real extraction model.

One test, and it is the one that justifies choosing a temporal knowledge graph
over a keyword index: when a later memory contradicts an earlier one, a search
must surface what is true *now*. Competing tools return both and leave the agent
to guess.

Run with:  uv run pytest -m e2e
Skipped by default — needs `docker compose up` and Ollama serving.
"""

from __future__ import annotations

import os
import uuid

import pytest

from drymem_server.memory_store import GraphitiMemoryStore, Metadata

pytestmark = [pytest.mark.e2e, pytest.mark.asyncio]

SKIP = not os.getenv("DRYMEM_E2E")
pytestmark.append(pytest.mark.skipif(SKIP, reason="set DRYMEM_E2E=1 to run"))


@pytest.fixture
async def store():
    return GraphitiMemoryStore()


@pytest.fixture
def group_id():
    """A throwaway group so the test never reads or writes real memories."""
    return f"test-{uuid.uuid4().hex[:12]}"


def meta() -> Metadata:
    return Metadata(project_key="github.com/acme/e2e", author="test@example.com")


async def test_a_saved_memory_can_be_found(store, group_id):
    await store.save(
        name="payments/provider",
        body="The payments module authorises card charges through Adyen.",
        group_id=group_id,
        metadata=meta(),
    )

    facts = await store.search(query="payments", group_ids=[group_id], limit=10)
    assert facts, "a saved memory must be searchable"
    assert any("payment" in f.fact.lower() or "adyen" in f.fact.lower() for f in facts)


async def test_metadata_survives_the_round_trip(store, group_id):
    await store.save(
        name="topic", body="A decision was recorded.", group_id=group_id, metadata=meta()
    )

    episodes = await store.recent(group_ids=[group_id], limit=5)
    assert episodes[0].metadata is not None
    assert episodes[0].metadata.author == "test@example.com"
    assert episodes[0].metadata.project_key == "github.com/acme/e2e"


async def test_a_later_memory_supersedes_a_contradicting_earlier_one(store, group_id):
    """The whole reason we pay for Graphiti instead of using full-text search.

    **Expect this one to flake.** It asserts that a local 35B model noticed a
    contradiction and invalidated the older fact, which is model behaviour, not
    ours — measured at roughly one failure in six runs, and only when the whole
    `-m e2e` set runs in one process, which is several minutes of sustained
    extraction. Observed failure: the live facts still named Adyen after Stripe
    replaced it.

    Left strict on purpose. Loosening it to accept either answer would delete
    the only check on the product's central claim. A red here means "re-run and
    look", not "the graph is broken" — and a *repeatable* red is worth chasing,
    because it would mean the extractor stopped reasoning about time.
    """
    await store.save(
        name="payments/provider",
        body="The payments module authorises card charges through Adyen.",
        group_id=group_id,
        metadata=meta(),
    )
    await store.save(
        name="payments/provider/update",
        body="We migrated payments off Adyen. Card charges now go through Stripe.",
        group_id=group_id,
        metadata=meta(),
    )

    facts = await store.search(query="payments provider", group_ids=[group_id], limit=20)
    assert facts, "search returned nothing"

    current = [f for f in facts if not f.superseded]
    assert current, "everything was marked superseded — nothing is true now"

    text = " ".join(f.fact.lower() for f in current)
    assert "stripe" in text, f"the current provider is missing from live facts: {text!r}"


async def test_episodes_are_isolated_by_group(store, group_id):
    other = f"{group_id}-other"
    await store.save(
        name="mine", body="A fact about my project.", group_id=group_id, metadata=meta()
    )

    assert await store.recent(group_ids=[other], limit=10) == []
