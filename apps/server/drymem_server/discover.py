"""
Finding the skills a team is missing, from what they keep running into.

This is the loop nobody else has: memory accumulates → the same subjects keep
coming up → the ones with no skill covering them are the gaps → a skill drafted
from those memories is grounded in what the team actually hit, not in someone
else's idea of best practice.

The clustering is deliberately plain. Graphiti already extracts entities and
links each episode to the ones it mentions, so "what does this team keep dealing
with" is a count over `(:Episodic)-[:MENTIONS]->(:Entity)`. No embeddings, no
tuning, and the answer is inspectable — which matters when the output is a
suggestion a human has to judge.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from drymem_server.graph import get_graphiti

# A subject mentioned once is an aside; the signal starts when it recurs.
DEFAULT_MIN_MEMORIES = 2

# Entities that name the project, a person, or a tool everyone uses say nothing
# about what the team struggles with.
GENERIC = frozenset(
    {
        "claude",
        "claude code",
        "drymem",
        "git",
        "github",
        "the team",
        "the user",
        "user",
    }
)


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


def _is_generic(name: str) -> bool:
    lowered = name.strip().lower()
    return lowered in GENERIC or len(lowered) < 3


def _names_from(people: list[str]) -> set[str]:
    """Every way a person might show up as an entity: name, email, local part."""
    out: set[str] = set()
    for person in people:
        if not person:
            continue
        lowered = person.strip().lower()
        out.add(lowered)
        if "@" in lowered:
            local = lowered.split("@", 1)[0]
            out.add(local)
            # miguel.barrientos -> miguel, barrientos
            out.update(part for part in local.replace(".", " ").split() if len(part) > 2)
        else:
            out.update(part for part in lowered.split() if len(part) > 2)
    return out


async def clusters_for(
    group_ids: list[str],
    *,
    min_memories: int = DEFAULT_MIN_MEMORIES,
    limit: int = 25,
    people: list[str] | None = None,
) -> list[Cluster]:
    """Recurring subjects across a project's memories, most-mentioned first.

    `people` are the project's members. They are filtered out because a
    teammate's name is always among the most-mentioned entities — every memory
    has an author — and "write a skill about Miguel" is not a suggestion anyone
    can act on. The graph gives entities no type, so membership is the one
    precise signal available for telling a person from a subject.
    """
    graphiti = await get_graphiti()
    records, _, _ = await graphiti.driver.execute_query(
        """
        MATCH (e:Episodic)-[:MENTIONS]->(n:Entity)
        WHERE e.group_id IN $group_ids
        WITH n, collect(DISTINCT e.uuid) AS episodes
        WHERE size(episodes) >= $min_memories
        RETURN n.name AS topic, n.summary AS summary, episodes
        ORDER BY size(episodes) DESC
        LIMIT $limit
        """,
        group_ids=group_ids,
        min_memories=min_memories,
        limit=limit,
    )

    excluded = _names_from(people or [])
    out: list[Cluster] = []
    for record in records:
        topic = record["topic"] or ""
        if _is_generic(topic) or topic.strip().lower() in excluded:
            continue
        summary = record["summary"]
        out.append(
            Cluster(
                topic=topic,
                memory_count=len(record["episodes"]),
                episode_uuids=list(record["episodes"]),
                facts=[summary] if summary else [],
            )
        )
    return out


async def memories_about(group_ids: list[str], topic: str, limit: int = 12) -> list[dict]:
    """The memories behind a cluster — the raw material a draft is written from."""
    graphiti = await get_graphiti()
    records, _, _ = await graphiti.driver.execute_query(
        """
        MATCH (e:Episodic)-[:MENTIONS]->(n:Entity)
        WHERE e.group_id IN $group_ids AND toLower(n.name) = toLower($topic)
        RETURN DISTINCT e.name AS name, e.content AS content, toString(e.created_at) AS created_at
        ORDER BY created_at DESC
        LIMIT $limit
        """,
        group_ids=group_ids,
        topic=topic,
        limit=limit,
    )
    return [
        {"name": r["name"], "content": r["content"], "created_at": r["created_at"]} for r in records
    ]
