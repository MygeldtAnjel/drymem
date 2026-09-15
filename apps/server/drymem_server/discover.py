"""
Finding the skills a team is missing, from what they keep running into.

This is the loop nobody else has: memory accumulates → the same parts of the
codebase keep coming up → the ones with no skill covering them are the gaps → a
skill drafted from those memories is grounded in what the team actually hit, not
in someone else's idea of best practice.

**Subjects come from the topic key the author wrote.** This has been wrong
twice, each time for the same reason: guessing a subject from the text.

The first version counted `(:Episodic)-[:MENTIONS]->(:Entity)` and suggested
skills about `npm`, `Docker` and `Haiku 4.5` — five hundred undifferentiated
nouns ranked by frequency. The second grouped by file path, which was better
but produced `apps/web`, fifteen memories spanning routing, CSS, Alembic
defaults and OAuth. A draft from those is a list of unrelated rules with a
directory for a title; Miguel's word for it was "nonsense", and he was right.

A memory already carries its subject. `ask/cards-numbered-from-one` says the
person writing it thought it was about *ask* — assigned, not inferred, and the
only signal here nobody had to guess. Memories with no topic key still fall
back to their file area, which is where the path work earns its keep.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from drymem_server.graph import get_graphiti
from drymem_server.tree import ROOT_AREA, area_of, paths_in

# An area touched once is an aside; the signal starts when it recurs.
DEFAULT_MIN_MEMORIES = 2

# Not somewhere a team skill lives. `repo root` is READMEs and lockfiles;
# `.claude` and `.drymem` are this tool's own configuration. `misc` and its
# friends are what somebody types when they have not decided on a subject.
NOT_A_SUBJECT = frozenset(
    {ROOT_AREA, ".claude", ".drymem", ".github", "node_modules", "misc", "other", "general", "tmp"}
)


def subjects_of(name: str, content: str) -> set[str]:
    """What one memory is about, best evidence first.

    The topic key when there is one: the author named the subject, so there is
    nothing to infer. Otherwise the areas of the files it touched.
    """
    head = (name or "").strip().split("/", 1)[0].strip().lower()
    if "/" in (name or "") and head and head not in NOT_A_SUBJECT:
        return {head}
    return {
        area
        for area in (area_of(path) for path in paths_in(content))
        if area and area not in NOT_A_SUBJECT
    }


@dataclass
class Cluster:
    """A subject the team's memories keep returning to."""

    topic: str
    memory_count: int
    episode_uuids: list[str] = field(default_factory=list)
    facts: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "topic": self.topic,
            "memory_count": self.memory_count,
            "episode_uuids": self.episode_uuids,
            "facts": self.facts,
        }


async def clusters_for(
    group_ids: list[str],
    *,
    min_memories: int = DEFAULT_MIN_MEMORIES,
    limit: int = 25,
    people: list[str] | None = None,
) -> list[Cluster]:
    """Parts of the codebase this project's memories keep returning to.

    `people` is accepted and unused: the previous version ranked extracted
    entities, where a teammate's name was always near the top because every
    memory has an author. An area cannot be a person, so the filter has nothing
    left to do — the parameter stays so callers do not have to change.
    """
    _ = people
    graphiti = await get_graphiti()
    records, _, _ = await graphiti.driver.execute_query(
        """
        MATCH (e:Episodic)
        WHERE e.group_id IN $group_ids
        RETURN e.uuid AS uuid, e.name AS name, e.content AS content
        ORDER BY e.created_at DESC
        LIMIT 500
        """,
        group_ids=group_ids,
    )

    episodes: dict[str, list[str]] = {}
    for record in records:
        # A memory with no topic key can still count for several areas: the
        # people who own the other two would go looking for it too.
        for subject in subjects_of(record["name"] or "", record["content"] or ""):
            episodes.setdefault(subject, []).append(record["uuid"])

    out = [
        Cluster(topic=subject, memory_count=len(uuids), episode_uuids=uuids)
        for subject, uuids in episodes.items()
        if len(uuids) >= min_memories
    ]
    out.sort(key=lambda c: (-c.memory_count, c.topic))
    return out[:limit]


async def memories_about(group_ids: list[str], topic: str, limit: int = 12) -> list[dict]:
    """The memories behind a subject — the raw material a draft is written from."""
    graphiti = await get_graphiti()
    records, _, _ = await graphiti.driver.execute_query(
        """
        MATCH (e:Episodic)
        WHERE e.group_id IN $group_ids
        RETURN e.name AS name, e.content AS content, toString(e.created_at) AS created_at
        ORDER BY e.created_at DESC
        LIMIT 500
        """,
        group_ids=group_ids,
    )

    wanted = topic.strip().lower()
    out: list[dict] = []
    for record in records:
        content = record["content"] or ""
        if wanted in {s.lower() for s in subjects_of(record["name"] or "", content)}:
            out.append(
                {"name": record["name"], "content": content, "created_at": record["created_at"]}
            )
        if len(out) >= limit:
            break
    return out
