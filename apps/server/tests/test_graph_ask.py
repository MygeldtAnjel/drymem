"""
The graph view and Ask.

Ask is tested for the thing that makes it safe rather than for the prose it
writes: that it refuses to answer when nothing matches, that it only ever hands
the model memories the caller may read, and that the sources it cites are the
ones retrieval actually chose. The wording is the model's and changes between
runs; the grounding is ours and must not.
"""

from __future__ import annotations

import pytest

from tests.conftest import add_member, auth

PROJECT = "github.com/acme/payments"


async def save(client, who="miguel", *, summary, topic, memory_type="note"):
    response = await client.post(
        "/v1/memories",
        headers=auth(client, who),
        json={
            "project_key": PROJECT,
            "summary": summary,
            "topic_key": topic,
            "type": memory_type,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def no_model(monkeypatch):
    """Answer without a model, echoing what it was given.

    The point of these tests is retrieval and grounding; calling a real model
    would make them slow, non-deterministic, and dependent on a machine having
    Ollama running.
    """
    from drymem_server import ask as ask_module

    async def fake(prompt: str, turns: list[dict] | None = None) -> tuple[str, str]:
        # The turns are echoed too, so a test can assert what the model saw.
        seen = "".join(f"\nTURN {t['role']}: {t['content']}" for t in turns or [])
        return f"ANSWERED FROM:\n{prompt}{seen}", "fake-model"

    monkeypatch.setattr(ask_module, "_answer_with_local", fake)
    monkeypatch.setattr(ask_module.settings, "anthropic_api_key", None)


# ---- who may ask -------------------------------------------------------------


@pytest.mark.asyncio
async def test_ask_needs_a_principal(client):
    response = await client.post(
        "/v1/ask", json={"project_key": PROJECT, "question": "anything at all"}
    )
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_graph_needs_a_principal(client):
    response = await client.get("/v1/graph", params={"project_key": PROJECT})
    assert response.status_code == 401


# ---- refusing to answer ------------------------------------------------------


@pytest.mark.asyncio
async def test_an_empty_project_says_so_and_calls_no_model(client, no_model):
    """The honest answer, and no model call to produce it."""
    response = await client.post(
        "/v1/ask",
        headers=auth(client),
        json={"project_key": PROJECT, "question": "who wrote the retry logic?"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["grounded"] is False
    assert body["model"] == "none"
    assert body["sources"] == []
    assert "nothing" in body["answer"].lower()


@pytest.mark.asyncio
async def test_another_org_gets_nothing_rather_than_your_memories(client, no_model):
    await save(client, "miguel", summary="We chose Adyen for retries.", topic="pay/retry")
    response = await client.post(
        "/v1/ask",
        headers=auth(client, "outsider"),
        json={"project_key": PROJECT, "question": "what did we choose for retries?"},
    )
    assert response.json()["sources"] == []
    assert response.json()["grounded"] is False


@pytest.mark.asyncio
async def test_a_teammates_private_memory_is_never_a_source(client, no_model, sessionmaker):
    """Jose is on the project, so he may ask — but not about what Miguel kept."""
    await save(client, "miguel", summary="Adyen was chosen for retries.", topic="pay/retry")
    await add_member(sessionmaker, PROJECT, client.world["people"]["jose"][0])

    response = await client.post(
        "/v1/ask",
        headers=auth(client, "jose"),
        json={"project_key": PROJECT, "question": "what did we choose for retries?"},
    )
    body = response.json()
    assert body["sources"] == []
    assert "Adyen" not in body["answer"]


@pytest.mark.asyncio
async def test_a_shared_memory_is_answerable_by_a_teammate(client, no_model, sessionmaker):
    saved = await save(client, "miguel", summary="Adyen was chosen for retries.", topic="pay/retry")
    await client.post(f"/v1/memories/{saved['episode_uuid']}/promote", headers=auth(client))
    await add_member(sessionmaker, PROJECT, client.world["people"]["jose"][0])

    body = (
        await client.post(
            "/v1/ask",
            headers=auth(client, "jose"),
            json={"project_key": PROJECT, "question": "what did we choose for retries?"},
        )
    ).json()
    assert len(body["sources"]) == 1
    assert "Adyen" in body["answer"]


# ---- choosing the sources ----------------------------------------------------


@pytest.mark.asyncio
async def test_the_memory_that_matches_is_cited_first(client, no_model):
    await save(client, summary="The deploy pipeline runs on Fridays.", topic="ops/deploy")
    await save(client, summary="Retries use exponential backoff, capped at 30s.", topic="pay/retry")
    await save(client, summary="The login page uses a magic link.", topic="auth/login")

    body = (
        await client.post(
            "/v1/ask",
            headers=auth(client),
            json={"project_key": PROJECT, "question": "how do retries back off?"},
        )
    ).json()

    assert body["sources"], "a matching memory should have been retrieved"
    assert body["sources"][0]["title"].lower().startswith("retries")
    # Numbered from one, because the prompt and the answer cite them that way.
    assert [s["index"] for s in body["sources"]] == list(range(1, len(body["sources"]) + 1))


@pytest.mark.asyncio
async def test_the_model_is_never_handed_more_than_the_cap(client, no_model):
    """Eight long memories degraded the local model to a single word."""
    from drymem_server import ask as ask_module

    for i in range(12):
        await save(client, summary=f"Retries note number {i}, about backoff.", topic=f"pay/{i}")

    body = (
        await client.post(
            "/v1/ask",
            headers=auth(client),
            json={"project_key": PROJECT, "question": "tell me about retries and backoff"},
        )
    ).json()
    assert len(body["sources"]) <= ask_module.MAX_SOURCES


@pytest.mark.asyncio
async def test_the_answer_carries_the_model_that_wrote_it(client, no_model):
    await save(client, summary="Retries use exponential backoff.", topic="pay/retry")
    body = (
        await client.post(
            "/v1/ask",
            headers=auth(client),
            json={"project_key": PROJECT, "question": "how do retries work?"},
        )
    ).json()
    # Which model answered is part of the claim: a local 35B and Opus are not
    # the same level of trust, and the reader should be told which they got.
    assert body["model"] == "fake-model"
    assert body["grounded"] is True


@pytest.mark.asyncio
async def test_an_empty_model_response_is_reported_rather_than_shown(client, monkeypatch):
    """A blank answer reads as 'your team never wrote this down'. It is not."""
    from drymem_server import ask as ask_module

    async def silent(prompt: str, turns: list[dict] | None = None) -> tuple[str, str]:
        return "   ", "fake-model"

    monkeypatch.setattr(ask_module, "_answer_with_local", silent)
    monkeypatch.setattr(ask_module.settings, "anthropic_api_key", None)

    await save(client, summary="Retries use exponential backoff.", topic="pay/retry")
    body = (
        await client.post(
            "/v1/ask",
            headers=auth(client),
            json={"project_key": PROJECT, "question": "how do retries work?"},
        )
    ).json()
    assert body["grounded"] is False
    assert body["sources"], "the memories that matched are still worth offering"
    assert "model returned nothing" in body["answer"]


# ---- capture mode ------------------------------------------------------------


@pytest.mark.asyncio
async def test_capture_mode_defaults_to_automatic(client):
    await save(client, summary="anything", topic="a")
    body = (
        await client.get("/v1/capture-mode", headers=auth(client), params={"project_key": PROJECT})
    ).json()
    assert body["capture_mode"] == "automatic"


@pytest.mark.asyncio
async def test_capture_mode_of_a_project_you_are_not_on_is_the_default(client):
    await save(client, "miguel", summary="anything", topic="a")
    body = (
        await client.get(
            "/v1/capture-mode",
            headers=auth(client, "outsider"),
            params={"project_key": PROJECT},
        )
    ).json()
    assert body["capture_mode"] == "automatic"


# ---- the graph view ----------------------------------------------------------


@pytest.mark.asyncio
async def test_graph_asks_only_for_groups_the_caller_may_read(client, monkeypatch):
    """The isolation rule, checked where it is actually enforced.

    Building the view needs Neo4j, which these tests do not have; what matters
    is which groups it is asked for, and that is ours.
    """
    from drymem_server import graph_view

    seen: dict[str, object] = {}

    async def spy(*, groups, limit, kinds, author, min_mentions):
        seen.update(
            groups=groups, limit=limit, kinds=kinds, author=author, min_mentions=min_mentions
        )
        return graph_view.GraphView()

    monkeypatch.setattr(graph_view, "build", spy)
    await save(client, summary="anything", topic="a")

    response = await client.get(
        "/v1/graph",
        headers=auth(client),
        params={"project_key": PROJECT, "limit": 50, "kind": "decision", "min_mentions": 3},
    )
    assert response.status_code == 200
    assert seen["limit"] == 50
    assert seen["kinds"] == ["decision"]
    assert seen["min_mentions"] == 3

    groups = seen["groups"]
    assert any("-team" in g for g in groups)
    # Never another person's private group.
    assert not any(g.endswith("-u-00000000") for g in groups)


@pytest.mark.asyncio
async def test_graph_min_mentions_is_bounded(client):
    await save(client, summary="anything", topic="a")
    too_low = await client.get(
        "/v1/graph", headers=auth(client), params={"project_key": PROJECT, "min_mentions": 0}
    )
    too_high = await client.get(
        "/v1/graph", headers=auth(client), params={"project_key": PROJECT, "min_mentions": 99}
    )
    assert too_low.status_code == 422
    assert too_high.status_code == 422


async def test_earlier_turns_reach_the_model(client, no_model):
    """"And why?" only means something if the model saw the question before it."""
    await save(client, summary="Retries cap at 30 seconds.", topic="pay/retry")

    body = (
        await client.post(
            "/v1/ask",
            json={
                "project_key": PROJECT,
                "question": "And why?",
                "history": [
                    {"role": "user", "content": "What is the retry cap?"},
                    {"role": "assistant", "content": "Thirty seconds [1]."},
                ],
            },
            headers=auth(client),
        )
    ).json()

    assert "TURN user: What is the retry cap?" in body["answer"]
    assert "TURN assistant: Thirty seconds." in body["answer"]


async def test_an_earlier_answers_citations_do_not_reach_the_model(client, no_model):
    """Its `[1]` meant that turn's memories, and would collide with this one's."""
    await save(client, summary="Retries cap at 30 seconds.", topic="pay/retry")

    body = (
        await client.post(
            "/v1/ask",
            json={
                "project_key": PROJECT,
                "question": "And why?",
                "history": [{"role": "assistant", "content": "Ana decided it [2] on Tuesday [3]."}],
            },
            headers=auth(client),
        )
    ).json()

    turn = next(l for l in body["answer"].splitlines() if l.startswith("TURN assistant:"))
    assert "[2]" not in turn and "[3]" not in turn
    assert "Ana decided it" in turn


async def test_no_history_is_the_normal_case(client, no_model):
    await save(client, summary="Retries cap at 30 seconds.", topic="pay/retry")

    body = (
        await client.post(
            "/v1/ask",
            json={"project_key": PROJECT, "question": "What is the retry cap?"},
            headers=auth(client),
        )
    ).json()

    assert "TURN" not in body["answer"]
    assert body["grounded"] is True


async def test_a_follow_up_retrieves_on_the_subject_of_the_last_question(client, no_model):
    """"And why?" has no searchable word in it."""
    await save(client, summary="The retry cap is thirty seconds.", topic="pay/retry")
    await save(client, summary="Invoices are generated nightly.", topic="billing/invoices")

    body = (
        await client.post(
            "/v1/ask",
            json={
                "project_key": PROJECT,
                "question": "And why?",
                "history": [{"role": "user", "content": "What is the retry cap?"}],
            },
            headers=auth(client),
        )
    ).json()

    # The fake model echoes the prompt, so the chosen memories are visible.
    assert "retry cap is thirty seconds" in body["answer"]


async def test_a_first_question_retrieves_on_itself_alone(client, no_model):
    await save(client, summary="The retry cap is thirty seconds.", topic="pay/retry")

    body = (
        await client.post(
            "/v1/ask",
            json={"project_key": PROJECT, "question": "What is the retry cap?"},
            headers=auth(client),
        )
    ).json()

    assert "retry cap is thirty seconds" in body["answer"]


async def test_the_graph_search_outranks_a_keyword_match(client, store, no_model):
    """The second retrieval pass has to be able to change the answer.

    It used to compare `Fact.name` — the *relationship type* Graphiti assigned,
    like `PUBLISHED_TO_PACKAGE_REGISTRY` — against an episode's name. Those can
    never match, so the pass was silently always empty and ranking was keyword
    overlap alone. Nothing noticed for months.

    So the memory the graph points at shares no word with the question, and the
    decoy has every word *and* is the more recent. Only the graph pass can put
    the right one first.
    """
    from drymem_server.memory_store import Fact

    wanted = await save(client, summary="Nothing lexical in common here.", topic="misc/thing")
    await save(
        client,
        summary="A bad skill installed by anyone stops nothing.",
        topic="decoy/keywords",
    )

    store.facts = [
        Fact(
            name="REJECTS_AND_LOGS_INPUT_OF",
            fact="The scanner refuses a credential outright.",
            episodes=[wanted["episode_uuid"]],
        )
    ]

    body = (
        await client.post(
            "/v1/ask",
            json={"project_key": PROJECT, "question": "What stops a bad skill being installed?"},
            headers=auth(client),
        )
    ).json()

    assert body["sources"][0]["uuid"] == wanted["episode_uuid"], (
        "the graph hit should outrank the keyword decoy"
    )


async def test_a_fact_carries_the_memories_it_came_from(client, store):
    """`Fact.episodes` is the link back; `Fact.name` is a relationship type."""
    from drymem_server.memory_store import Fact

    saved = await save(client, summary="Retries cap at thirty seconds.", topic="pay/cap")
    store.facts = [Fact(name="CAPS_AT", fact="Retries cap.", episodes=[saved["episode_uuid"]])]

    body = (
        await client.get(
            f"/v1/memories/search?project_key={PROJECT}&q=retries", headers=auth(client)
        )
    ).json()

    assert body["results"][0]["name"] == "CAPS_AT"
