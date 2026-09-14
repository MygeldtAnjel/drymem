"""
Finding the skills a team is missing, from what they keep running into.

This is the loop nobody else has: memory accumulates → the same parts of the
codebase keep coming up → the ones with no skill covering them are the gaps → a
skill drafted from those memories is grounded in what the team actually hit, not
in someone else's idea of best practice.

**Subjects come from file paths, not from extracted entities.** The first
version counted `(:Episodic)-[:MENTIONS]->(:Entity)` and suggested drafting
skills about `npm`, `Docker`, `TypeScript` and `Haiku 4.5` — which is what you
get when extraction produces five hundred undifferentiated nouns and you rank
them by frequency. Every filter tried on top of that (only near the top of a
memory, only decisions, a stoplist) removed some noise and some signal, because
the store cannot tell `npm` from `payments`.

An area can. Memories name the files they touched, a path is a hierarchy, and
"seven decisions about `apps/api` and no skill covering it" is a suggestion a
person can act on. Same signal as the decision tree, for the same reason.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from drymem_server.graph import get_graphiti
from drymem_server.tree import ROOT_AREA, area_of, paths_in

# An area touched once is an aside; the signal starts when it recurs.
DEFAULT_MIN_MEMORIES = 2

# Not somewhere a team skill lives. `repo root` is READMEs and lockfiles;
# `.claude` and `.drymem` are this tool's own configuration.
NOT_A_SUBJECT = frozenset({ROOT_AREA, ".claude", ".drymem", ".github", "node_modules"})


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
        RETURN e.uuid AS uuid, e.content AS content
        ORDER BY e.created_at DESC
        LIMIT 500
        """,
        group_ids=group_ids,
    )

    episodes: dict[str, list[str]] = {}
    for record in records:
        content = record["content"] or ""
        # One memory touching three services counts for all three: the people
        # who own the other two would go looking for it too.
        for area in {area_of(path) for path in paths_in(content)}:
            if area in NOT_A_SUBJECT or not area:
                continue
            episodes.setdefault(area, []).append(record["uuid"])

    out = [
        Cluster(topic=area, memory_count=len(uuids), episode_uuids=uuids)
        for area, uuids in episodes.items()
        if len(uuids) >= min_memories
    ]
    out.sort(key=lambda c: (-c.memory_count, c.topic))
    return out[:limit]


async def memories_about(group_ids: list[str], topic: str, limit: int = 12) -> list[dict]:
    """The memories behind an area — the raw material a draft is written from."""
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
        if any(area_of(path).lower() == wanted for path in paths_in(content)):
            out.append(
                {"name": record["name"], "content": content, "created_at": record["created_at"]}
            )
        if len(out) >= limit:
            break
    return out
