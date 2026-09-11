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

from drymem_server.auth import Principal, ensure_project, project_for
from drymem_server.db.models import (
    SCOPE_PRIVATE,
    SCOPE_TEAM,
    AuditLog,
    Memory,
    MemoryFeedback,
    Project,
    User,
)
from drymem_server.identity import group_id_private, group_id_team, sanitize_group_id
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

    def private_group(self, project_key: str) -> str:
        """Where this caller's own memories go. Writes only ever land here."""
        return group_id_private(project_key, self.principal.user_id)

    async def readable_groups(self, project_key: str) -> list[str]:
        """What this caller may read: the team's group and their own.

        Isolation is the database's job. Neo4j is asked for exactly these
        groups, so a third person's private memory cannot come back — as opposed
        to fetching everything and filtering, which is one forgotten condition
        away from a silent leak.

        The pre-3A unscoped group is added **only while the caller is the
        project's sole member**. Those memories have no scope, so on a shared
        project they could expose one person's notes to everyone; on a project
        of one there is nobody to expose them to. The moment a second member
        joins they stop being read, which is what makes `migrate-scopes` a
        visible step rather than a silent leak.
        """
        groups = [group_id_team(project_key), self.private_group(project_key)]
        if await self._is_sole_member(project_key):
            groups.append(sanitize_group_id(project_key))
        return groups

    async def _is_sole_member(self, project_key: str) -> bool:
        from drymem_server.db.models import ProjectMember

        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return False
        count = await self.session.execute(
            select(func.count(ProjectMember.id)).where(ProjectMember.project_id == project.id)
        )
        return (count.scalar() or 0) <= 1

    def audit(self, action: str, target: str) -> None:
        self.session.add(
            AuditLog(
                org_id=self.principal.org_id,
                actor_id=self.principal.user_id,
                action=action,
                target=target,
            )
        )

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
            group_id=self.private_group(project_key),
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
            query=query, group_ids=await self.readable_groups(project_key), limit=limit
        )

    async def context(self, *, project_key: str, limit: int) -> list[Episode]:
        """Recent memories, team first.

        The session-start hook has a budget of a few hundred tokens. Spending it
        on your own half-finished note when a teammate has already vouched for
        an answer is the wrong trade.
        """
        episodes = await self.store.recent(
            group_ids=await self.readable_groups(project_key), limit=limit
        )
        shared = [e for e in episodes if e.metadata and e.metadata.scope == SCOPE_TEAM]
        own = [e for e in episodes if not (e.metadata and e.metadata.scope == SCOPE_TEAM)]
        return (shared + own)[:limit]

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

    async def promote(self, *, episode_uuid: str) -> Memory | None:
        """Copy a memory into the team group so every member can read it.

        A copy, not a move: the private original stays, so sharing never costs
        the author their own record, and the audit trail keeps "what they wrote"
        separate from "what they chose to publish".

        Idempotent — promoting twice is a no-op, not a duplicate.
        """
        result = await self.session.execute(
            select(Memory).where(
                Memory.episode_uuid == episode_uuid,
                Memory.org_id == self.principal.org_id,
                Memory.author_id == self.principal.user_id,
            )
        )
        memory = result.scalar_one_or_none()
        if memory is None:
            return None
        if memory.scope == SCOPE_TEAM:
            return memory

        project = await self.session.get(Project, memory.project_id)
        if project is None:
            return None

        episodes = await self.store.recent(
            group_ids=[self.private_group(project.project_key)], limit=200
        )
        original = next((e for e in episodes if e.uuid == episode_uuid), None)
        if original is None:
            return None

        await self.store.save(
            name=original.name,
            body=original.content,
            group_id=group_id_team(project.project_key),
            metadata=Metadata(
                project_key=project.project_key,
                author=self.principal.email,
                tool=memory.tool,
                scope=SCOPE_TEAM,
            ),
        )

        memory.scope = SCOPE_TEAM
        memory.promoted_at = datetime.now(UTC)
        memory.promoted_by = self.principal.user_id
        self.audit("memory.promote", episode_uuid)
        await self.session.flush()
        return memory

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

    async def members(self, *, project_key: str) -> list[tuple[User, str]] | None:
        """Who is on this project — only visible to a member of it."""
        from drymem_server.db.models import ProjectMember

        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return None

        rows = await self.session.execute(
            select(User, ProjectMember.role)
            .join(ProjectMember, ProjectMember.user_id == User.id)
            .where(ProjectMember.project_id == project.id)
            .order_by(User.email)
        )
        return [(user, role) for user, role in rows.all()]

    async def add_member(self, *, project_key: str, email: str) -> list[tuple[User, str]] | None:
        """Add a teammate. Same-org only: a project cannot reach across tenants."""
        from drymem_server.db.models import ProjectMember

        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return None

        invitee = (
            await self.session.execute(
                select(User).where(User.email == email, User.org_id == self.principal.org_id)
            )
        ).scalar_one_or_none()
        if invitee is None:
            return None

        already = (
            await self.session.execute(
                select(ProjectMember).where(
                    ProjectMember.project_id == project.id,
                    ProjectMember.user_id == invitee.id,
                )
            )
        ).scalar_one_or_none()
        if already is None:
            self.session.add(ProjectMember(project_id=project.id, user_id=invitee.id))
            self.audit("project.add_member", f"{project_key}:{email}")
            await self.session.flush()

        return await self.members(project_key=project_key)

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
