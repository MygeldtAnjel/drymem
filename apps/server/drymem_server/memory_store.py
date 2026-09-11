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
    schema_version: int = SCHEMA_VERSION

    def encode(self) -> str:
        return json.dumps(
            {
                "drymem": self.schema_version,
                "project_key": self.project_key,
                "author": self.author,
                "tool": self.tool,
                "scope": self.scope,
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

    async def recent(self, *, group_ids: list[str], limit: int) -> list[Episode]: ...

    async def delete(self, episode_id: str) -> None: ...


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
            )
            for edge in edges
        ]

    async def recent(self, *, group_ids: list[str], limit: int) -> list[Episode]:
        graphiti = await self._graphiti()
        episodes = await graphiti.retrieve_episodes(
            reference_time=datetime.now(UTC),
            last_n=limit,
            group_ids=group_ids,
        )
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

    async def delete(self, episode_id: str) -> None:
        graphiti = await self._graphiti()
        await graphiti.remove_episode(episode_id)
