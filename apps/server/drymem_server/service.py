"""
What a memory operation actually does, end to end.

One place that owns the order of events, because the order is the interesting
part: scrub before anything is stored or sent to a model; write the graph before
the index, so the index never points at an episode that does not exist.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from drymem_server.auth import Principal, ensure_project
from drymem_server.db.models import SCOPE_PRIVATE, Memory, MemoryFeedback, Project
from drymem_server.identity import sanitize_group_id
from drymem_server.memory_store import Episode, Fact, MemoryStore, Metadata
from drymem_server.scrubber import ScrubResult, scrub
from drymem_server.settings import settings

_TITLE_LIMIT = 500


def denylist() -> list[str]:
    return [x for x in settings.scrub_denylist.split(",") if x.strip()]


def _title_from(name: str, body: str) -> str:
    """A human-readable label for the index, so listing memories needs no graph."""
    for line in body.splitlines():
        stripped = line.strip().lstrip("#").strip()
        if stripped:
            return stripped[:_TITLE_LIMIT]
    return name[:_TITLE_LIMIT]


@dataclass
class SavedMemory:
    row: Memory
    episode_uuid: str
    entity_count: int
    edge_count: int
    scrub: ScrubResult
    degraded: str | None


class MemoryService:
    """Memory operations for one authenticated caller."""

    def __init__(self, session: AsyncSession, store: MemoryStore, principal: Principal):
        self.session = session
        self.store = store
        self.principal = principal

    def group_id(self, project_key: str) -> str:
        return sanitize_group_id(project_key)

    async def save(
        self,
        *,
        project_key: str,
        body: str,
        name: str,
        tool: str,
        topic_key: str | None = None,
    ) -> SavedMemory:
        # Scrub first. Everything after this point either stores the text or
        # sends it to a model, and both are too late to take a secret back.
        cleaned = scrub(body, denylist())

        project = await ensure_project(self.session, self.principal, project_key)
        metadata = Metadata(
            project_key=project_key,
            author=self.principal.email,
            tool=tool,
            scope=SCOPE_PRIVATE,
        )

        result = await self.store.save(
            name=name,
            body=cleaned.text,
            group_id=self.group_id(project_key),
            metadata=metadata,
        )

        # Graph first, index second: a row pointing at a missing episode would
        # be a memory that lists but cannot be read.
        row = Memory(
            org_id=self.principal.org_id,
            project_id=project.id,
            author_id=self.principal.user_id,
            episode_uuid=result.uuid,
            topic_key=topic_key or None,
            title=_title_from(name, cleaned.text),
            tool=tool,
            scope=SCOPE_PRIVATE,
        )
        self.session.add(row)
        await self.session.flush()

        return SavedMemory(
            row=row,
            episode_uuid=result.uuid,
            entity_count=result.entity_count,
            edge_count=result.edge_count,
            scrub=cleaned,
            degraded=result.degraded,
        )

    async def search(self, *, project_key: str, query: str, limit: int) -> list[Fact]:
        return await self.store.search(
            query=query, group_ids=[self.group_id(project_key)], limit=limit
        )

    async def context(self, *, project_key: str, limit: int) -> list[Episode]:
        return await self.store.recent(group_ids=[self.group_id(project_key)], limit=limit)

    async def episodes_for_topic(self, *, project_key: str, topic_key: str) -> list[Episode]:
        recent = await self.context(project_key=project_key, limit=50)
        return [
            ep
            for ep in recent
            if ep.name == topic_key or ep.name.startswith(f"{topic_key}/update-")
        ]

    async def delete(self, *, episode_uuid: str) -> bool:
        """Remove an episode, and its index row.

        Scoped to the caller's org: a uuid from another tenant is simply not
        found, so knowing a uuid is not enough to delete someone else's memory.
        """
        result = await self.session.execute(
            select(Memory).where(
                Memory.episode_uuid == episode_uuid,
                Memory.org_id == self.principal.org_id,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            return False

        await self.store.delete(episode_uuid)
        await self.session.delete(row)
        await self.session.flush()
        return True

    async def rate(self, *, episode_uuid: str, rating: int, query: str) -> bool:
        """Record a thumb on a memory. Changing your mind replaces the rating.

        Scoped to the caller's org, like delete: a uuid alone must not let one
        tenant write rows against another's memory.
        """
        result = await self.session.execute(
            select(Memory).where(
                Memory.episode_uuid == episode_uuid,
                Memory.org_id == self.principal.org_id,
            )
        )
        memory = result.scalar_one_or_none()
        if memory is None:
            return False

        existing = await self.session.execute(
            select(MemoryFeedback).where(
                MemoryFeedback.memory_id == memory.id,
                MemoryFeedback.user_id == self.principal.user_id,
                MemoryFeedback.query == query,
            )
        )
        row = existing.scalar_one_or_none()
        if row is not None:
            row.rating = rating
        else:
            self.session.add(
                MemoryFeedback(
                    memory_id=memory.id,
                    user_id=self.principal.user_id,
                    rating=rating,
                    query=query,
                )
            )
        await self.session.flush()
        return True

    async def projects(self) -> list[tuple[Project, int, int, int]]:
        from drymem_server.db.models import ProjectMember

        # count(distinct) because the feedback join multiplies memory rows.
        result = await self.session.execute(
            select(
                Project,
                func.count(func.distinct(Memory.id)),
                func.count(func.distinct(case((MemoryFeedback.rating > 0, MemoryFeedback.id)))),
                func.count(func.distinct(case((MemoryFeedback.rating < 0, MemoryFeedback.id)))),
            )
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .outerjoin(Memory, Memory.project_id == Project.id)
            .outerjoin(MemoryFeedback, MemoryFeedback.memory_id == Memory.id)
            .where(
                ProjectMember.user_id == self.principal.user_id,
                Project.org_id == self.principal.org_id,
            )
            .group_by(Project.id)
            .order_by(Project.project_key)
        )
        return [tuple(row) for row in result.all()]

    @staticmethod
    def timestamp() -> str:
        return datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
