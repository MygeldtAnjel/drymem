"""
The only module that knows Graphiti exists.

Graphiti removes and renames model fields between minor versions — `EntityEdge`
lost `source_node_name` in one such release and broke `mem_search`. Everything
above this file speaks in the dataclasses below, so the next break is a change
to one class instead of a hunt through the tools.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Protocol

from drymem_server.identity import SCHEMA_VERSION


@dataclass(frozen=True)
class Metadata:
    """Provenance stored alongside an episode.

    Until Postgres arrives (step 2A) this rides in Graphiti's
    `source_description`, which keeps it out of the text the extractor reads.
    """

    project_key: str
    author: str
    tool: str = "claude-code"
    scope: str = "private"
    memory_type: str = "note"
    # Empty rather than None so an episode written by a tool that does not
    # track sessions still round-trips through `encode`/`decode` unchanged.
    session_id: str = ""
    schema_version: int = SCHEMA_VERSION

    def encode(self) -> str:
        return json.dumps(
            {
                "drymem": self.schema_version,
                "project_key": self.project_key,
                "author": self.author,
                "tool": self.tool,
                "scope": self.scope,
                "type": self.memory_type,
                "session_id": self.session_id,
            },
            separators=(",", ":"),
        )

    @classmethod
    def decode(cls, raw: str | None) -> Metadata | None:
        """Read metadata back, tolerating episodes written before it existed."""
        if not raw or not raw.lstrip().startswith("{"):
            return None
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            return None
        if "drymem" not in data:
            return None
        return cls(
            project_key=data.get("project_key", ""),
            author=data.get("author", ""),
            tool=data.get("tool", ""),
            scope=data.get("scope", "private"),
            memory_type=data.get("type", "note"),
            session_id=data.get("session_id", ""),
            schema_version=data.get("drymem", 0),
        )


@dataclass(frozen=True)
class SaveResult:
    uuid: str
    entity_count: int
    edge_count: int
    # Set when extraction failed and only the episode was written. The memory is
    # still retrievable by recency and text; it just has no edges in the graph.
    degraded: str | None = None


@dataclass(frozen=True)
class Fact:
    """One edge from the graph: something the team established."""

    name: str
    fact: str
    created_at: datetime | None = None
    valid_at: datetime | None = None
    invalid_at: datetime | None = None
    # The memories this was drawn from. `name` is the *relationship type* —
    # `PUBLISHED_TO_PACKAGE_REGISTRY` — and points back at nothing.
    episodes: list[str] = field(default_factory=list)

    @property
    def superseded(self) -> bool:
        """True once a later episode contradicted this fact."""
        return self.invalid_at is not None


@dataclass(frozen=True)
class Episode:
    uuid: str
    name: str
    content: str
    created_at: datetime | None = None
    metadata: Metadata | None = None


class MemoryStore(Protocol):
    """What the tools need from a memory backend. Graphiti is one implementation."""

    async def save(
        self, *, name: str, body: str, group_id: str, metadata: Metadata
    ) -> SaveResult: ...

    async def search(self, *, query: str, group_ids: list[str], limit: int) -> list[Fact]: ...

    async def search_episodes(
        self, *, query: str, group_ids: list[str], limit: int
    ) -> list[Episode]: ...

    async def recent(
        self,
        *,
        group_ids: list[str],
        limit: int,
        before: datetime | None = None,
        before_uuid: str | None = None,
    ) -> list[Episode]: ...

    async def by_uuids(self, *, uuids: list[str]) -> dict[str, Episode]: ...

    async def delete(self, episode_id: str) -> None: ...


# Lucene's own operators, which a person typing a path or a package name has no
# idea they are using. `apps/api` and `foo:bar` are queries, not syntax.
_LUCENE_SPECIAL = r'+-&|!(){}[]^"~*?:\\/'


def _lucene_safe(query: str) -> str:
    """A person's words, escaped, each one open at the end.

    Escaped because Lucene's operators are characters people type without
    meaning them — `apps/api` and `foo:bar` are queries, not syntax.

    Open at the end because the index stores whole tokens and prose is full of
    possessives and plurals: a memory saying "the scanner's `.env` rule" indexes
    `scanner's`, and somebody searching "scanner" found nothing at all. A
    trailing `*` matches the bare word too, so nothing is lost by it.
    """
    terms = []
    for word in query.strip().split():
        escaped = "".join(("\\" + c) if c in _LUCENE_SPECIAL else c for c in word)
        if escaped:
            terms.append(f"{escaped}*")
    return " ".join(terms)


def _as_datetime(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value
    to_native = getattr(value, "to_native", None)
    return to_native() if callable(to_native) else None


@dataclass
class GraphitiMemoryStore:
    """MemoryStore backed by Graphiti + Neo4j."""

    _client: Any = field(default=None, repr=False)

    async def _graphiti(self) -> Any:
        if self._client is None:
            from drymem_server.graph import get_graphiti

            self._client = await get_graphiti()
        return self._client

    async def save(self, *, name: str, body: str, group_id: str, metadata: Metadata) -> SaveResult:
        graphiti = await self._graphiti()
        try:
            result = await graphiti.add_episode(
                name=name,
                episode_body=body,
                source_description=metadata.encode(),
                reference_time=datetime.now(UTC),
                group_id=group_id,
            )
        except Exception as exc:  # noqa: BLE001 - see _save_episode_only
            return await self._save_episode_only(name, body, group_id, metadata, exc)

        return SaveResult(
            uuid=result.episode.uuid,
            entity_count=len(result.nodes or []),
            edge_count=len(result.edges or []),
        )

    async def link_supersedes(self, *, newer: str, older: list[str]) -> int:
        """Record that one memory replaced others.

        Written, never inferred (D45). The decision tree draws a memory as
        replaced only when this edge exists, so guessing it from similar text
        would put invented history in front of someone deciding from it.
        """
        if not older:
            return 0
        graphiti = await self._graphiti()
        records, _, _ = await graphiti.driver.execute_query(
            """
            MATCH (new:Episodic {uuid: $newer})
            MATCH (old:Episodic) WHERE old.uuid IN $older AND old.uuid <> $newer
            MERGE (new)-[:SUPERSEDES]->(old)
            RETURN count(old) AS n
            """,
            newer=newer,
            older=older,
        )
        return int(records[0]["n"]) if records else 0

    async def _save_episode_only(
        self, name: str, body: str, group_id: str, metadata: Metadata, exc: Exception
    ) -> SaveResult:
        """Persist the episode alone when extraction failed.

        Extraction is the slow, fallible half of a save — a model that is down,
        out of memory, or returning garbage. Letting that lose the memory would
        be the worst possible trade: the summary is the thing a human wrote and
        cannot easily reproduce, while the entities can be re-derived later by
        re-ingesting. So the episode is written without a graph around it.
        """
        from graphiti_core.nodes import EpisodeType, EpisodicNode

        episode = EpisodicNode(
            name=name,
            group_id=group_id,
            labels=[],
            source=EpisodeType.text,
            content=body,
            source_description=metadata.encode(),
            created_at=datetime.now(UTC),
            valid_at=datetime.now(UTC),
        )
        graphiti = await self._graphiti()
        await episode.save(graphiti.driver)
        return SaveResult(uuid=episode.uuid, entity_count=0, edge_count=0, degraded=str(exc)[:200])

    async def search(self, *, query: str, group_ids: list[str], limit: int) -> list[Fact]:
        graphiti = await self._graphiti()
        edges = await graphiti.search(query=query, group_ids=group_ids, num_results=limit)
        return [
            Fact(
                name=edge.name or "",
                fact=edge.fact or edge.name or "",
                created_at=edge.created_at,
                valid_at=getattr(edge, "valid_at", None),
                invalid_at=getattr(edge, "invalid_at", None),
                episodes=list(getattr(edge, "episodes", None) or []),
            )
            for edge in edges
        ]

    async def search_episodes(
        self, *, query: str, group_ids: list[str], limit: int
    ) -> list[Episode]:
        """The memories that match, rather than the facts drawn out of them.

        Someone searching "lockfile" wants the memory that talks about the
        lockfile. The edge search answers a different question — it returns
        what the graph *concluded*, which for a loose query is thirty
        low-relevance statements with no way back to anything you can read.

        Neo4j's own full-text index over episode content, which Graphiti
        maintains anyway. Lucene syntax is escaped rather than passed through:
        a person typing `apps/api` or `a:b` should get results, not a parser
        error.
        """
        graphiti = await self._graphiti()
        escaped = _lucene_safe(query)
        if not escaped:
            return []

        records, _, _ = await graphiti.driver.execute_query(
            """
            CALL db.index.fulltext.queryNodes('episode_content', $query)
            YIELD node, score
            WITH node, score WHERE node.group_id IN $group_ids
            RETURN node.uuid AS uuid, node.name AS name, node.content AS content,
                   node.created_at AS created_at,
                   node.source_description AS meta
            ORDER BY score DESC
            LIMIT $limit
            """,
            query=escaped,
            group_ids=group_ids,
            limit=limit,
        )
        return [
            Episode(
                uuid=r["uuid"],
                name=r["name"] or "",
                content=r["content"] or "",
                created_at=_as_datetime(r["created_at"]),
                metadata=Metadata.decode(r["meta"]),
            )
            for r in records
        ]

    async def recent(
        self,
        *,
        group_ids: list[str],
        limit: int,
        before: datetime | None = None,
        before_uuid: str | None = None,
    ) -> list[Episode]:
        """The newest episodes, or the newest older than the cursor.

        The cursor is a time **and** a uuid, and the uuid is not decoration:
        Graphiti's `reference_time` is inclusive, so asking for "older than the
        last item I saw" hands that item back a second time. Measured against
        real data it was one duplicate on every page boundary — eight across
        nine pages. Naming the item lets it be dropped.

        One extra row is fetched to replace it, so a page stays a full page.
        """
        graphiti = await self._graphiti()
        episodes = await graphiti.retrieve_episodes(
            reference_time=before or datetime.now(UTC),
            last_n=limit + (1 if before_uuid else 0),
            group_ids=group_ids,
        )
        if before_uuid:
            episodes = [ep for ep in episodes if ep.uuid != before_uuid]
        return [
            Episode(
                uuid=ep.uuid,
                name=ep.name or "",
                content=ep.content or "",
                created_at=ep.created_at,
                metadata=Metadata.decode(getattr(ep, "source_description", None)),
            )
            for ep in episodes
        ]

    async def by_uuids(self, *, uuids: list[str]) -> dict[str, Episode]:
        """The episodes with these uuids, by uuid.

        For a browsable list, where the *page* is decided in Postgres — one row
        per memory, with a count and an offset — and only the bodies come from
        the graph. Paging the graph directly would mean paging promoted
        memories twice, because promotion copies the episode into the team
        group and both copies are readable by its author.
        """
        if not uuids:
            return {}
        graphiti = await self._graphiti()
        records, _, _ = await graphiti.driver.execute_query(
            """
            MATCH (e:Episodic)
            WHERE e.uuid IN $uuids
            RETURN e.uuid AS uuid, e.name AS name, e.content AS content,
                   e.created_at AS created_at, e.source_description AS source_description
            """,
            uuids=uuids,
        )
        return {
            record["uuid"]: Episode(
                uuid=record["uuid"],
                name=record["name"] or "",
                content=record["content"] or "",
                created_at=_as_datetime(record["created_at"]),
                metadata=Metadata.decode(record["source_description"]),
            )
            for record in records
        }

    async def delete(self, episode_id: str) -> None:
        graphiti = await self._graphiti()
        await graphiti.remove_episode(episode_id)
