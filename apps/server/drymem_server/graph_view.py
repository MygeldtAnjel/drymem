"""
The knowledge graph, shaped for a canvas.

Graphiti has been building this since the first memory was saved and nobody has
ever looked at it. Two kinds of node come back — the memories themselves, and
the entities they mention — joined by `MENTIONS`, with entity-to-entity facts
drawn between the entities.

Two rules the queries never bend:

* **Only the caller's groups.** Every clause filters on `group_id`, so a third
  person's private memory cannot become a node on someone else's canvas. This is
  the same rule as search (PLAN.md D18) and it is enforced the same way — by
  asking for the right groups, not by filtering afterwards.
* **A cap, always.** A canvas with four thousand nodes is not a view of
  anything, and the query that builds it is the one that takes the database
  down. What comes back is the most recent slice, and the response says how much
  was left out.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from drymem_server.graph import get_graphiti
from drymem_server.memory_store import Metadata

# Enough to see the shape of a project, few enough to lay out and to read.
DEFAULT_LIMIT = 120
MAX_LIMIT = 400

# A subject only one memory mentions is a leaf: it adds a node and tells you
# nothing about how anything connects. Drawing all of them turned the first
# render of this into 173 nodes and 447 edges — technically the whole graph,
# and useless. Two is the point at which a subject starts joining things up.
DEFAULT_MIN_MENTIONS = 2


@dataclass
class Node:
    id: str
    kind: str  # "memory" | "entity"
    label: str
    # Memories only.
    memory_type: str = ""
    author: str = ""
    scope: str = ""
    created_at: datetime | None = None
    # Entities only: how many of the returned memories mention it.
    mentions: int = 0


@dataclass
class Edge:
    id: str
    source: str
    target: str
    kind: str  # "mentions" | "fact"
    label: str = ""
    superseded: bool = False


@dataclass
class GraphView:
    nodes: list[Node] = field(default_factory=list)
    edges: list[Edge] = field(default_factory=list)
    truncated: bool = False
    total_memories: int = 0


def _iso(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    # neo4j.time.DateTime and friends know how to become one.
    to_native = getattr(value, "to_native", None)
    return to_native() if callable(to_native) else None


async def build(
    *,
    groups: list[str],
    limit: int = DEFAULT_LIMIT,
    kinds: list[str] | None = None,
    author: str | None = None,
    min_mentions: int = DEFAULT_MIN_MENTIONS,
) -> GraphView:
    """The graph as nodes and edges, newest memories first.

    Layout is the browser's job. This returns the data and nothing about where
    it goes, so changing the layout never means changing a query.
    """
    limit = max(1, min(limit, MAX_LIMIT))
    graphiti = await get_graphiti()

    counted, _, _ = await graphiti.driver.execute_query(
        "MATCH (e:Episodic) WHERE e.group_id IN $groups RETURN count(e) AS n",
        groups=groups,
    )
    total = int(counted[0]["n"]) if counted else 0

    records, _, _ = await graphiti.driver.execute_query(
        """
        MATCH (e:Episodic)
        WHERE e.group_id IN $groups
        WITH e ORDER BY e.created_at DESC LIMIT $limit
        OPTIONAL MATCH (e)-[:MENTIONS]->(n:Entity)
        RETURN e.uuid AS uuid,
               e.name AS name,
               e.created_at AS created_at,
               e.source_description AS meta,
               left(e.content, 400) AS gist,
               collect(DISTINCT {uuid: n.uuid, name: n.name}) AS entities
        """,
        groups=groups,
        limit=limit,
    )

    view = GraphView(truncated=total > limit, total_memories=total)
    entity_names: dict[str, str] = {}
    mention_counts: dict[str, int] = {}
    wanted = {k for k in (kinds or []) if k}
    # Promotion copies an episode into the team group, so the author reads both
    # and a shared memory would otherwise appear on the canvas twice. Same name
    # and same opening is the same memory; the shared copy wins, as it does in
    # `MemoryService.context`.
    seen: dict[tuple[str, str], str] = {}

    for record in records:
        meta = Metadata.decode(record["meta"])
        kind = meta.memory_type if meta else "note"
        who = meta.author if meta else ""
        if wanted and kind not in wanted:
            continue
        if author and who != author:
            continue

        uuid = record["uuid"]
        identity = (record["name"] or "", record["gist"] or "")
        first = seen.get(identity)
        if first is not None:
            # Keep the shared one: "this is the team's" is the more useful of
            # the two things a node can say.
            if (meta.scope if meta else "private") != "team":
                continue
            view.nodes = [n for n in view.nodes if n.id != first]
            view.edges = [e for e in view.edges if e.source != first]
        seen[identity] = uuid

        view.nodes.append(
            Node(
                id=uuid,
                kind="memory",
                label=record["name"] or "(untitled)",
                memory_type=kind,
                author=who,
                scope=meta.scope if meta else "private",
                created_at=_iso(record["created_at"]),
            )
        )

        for entity in record["entities"]:
            if not entity or not entity.get("uuid"):
                continue
            entity_id = entity["uuid"]
            entity_names[entity_id] = entity.get("name") or "(unnamed)"
            mention_counts[entity_id] = mention_counts.get(entity_id, 0) + 1
            view.edges.append(
                Edge(
                    id=f"m:{uuid}:{entity_id}",
                    source=uuid,
                    target=entity_id,
                    kind="mentions",
                )
            )

    # Keep the subjects that join memories together; drop the leaves, and the
    # edges that only ever pointed at them.
    kept = {
        entity_id for entity_id, count in mention_counts.items() if count >= max(1, min_mentions)
    }
    view.edges = [e for e in view.edges if e.kind != "mentions" or e.target in kept]
    for entity_id in kept:
        view.nodes.append(
            Node(
                id=entity_id,
                kind="entity",
                label=entity_names[entity_id],
                mentions=mention_counts[entity_id],
            )
        )
    entity_names = {k: v for k, v in entity_names.items() if k in kept}

    if entity_names:
        facts, _, _ = await graphiti.driver.execute_query(
            """
            MATCH (a:Entity)-[r:RELATES_TO]->(b:Entity)
            WHERE a.uuid IN $ids AND b.uuid IN $ids AND r.group_id IN $groups
            RETURN r.uuid AS uuid, a.uuid AS source, b.uuid AS target,
                   r.fact AS fact, r.invalid_at AS invalid_at
            """,
            ids=list(entity_names),
            groups=groups,
        )
        for fact in facts:
            view.edges.append(
                Edge(
                    id=f"f:{fact['uuid']}",
                    source=fact["source"],
                    target=fact["target"],
                    kind="fact",
                    label=fact["fact"] or "",
                    # A later memory contradicted it; the canvas draws it struck
                    # rather than hiding it, because "we changed our mind" is
                    # the most useful thing a decision graph can show.
                    superseded=fact["invalid_at"] is not None,
                )
            )

    return view
