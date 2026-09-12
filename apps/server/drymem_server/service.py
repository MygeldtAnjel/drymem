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

from drymem_server.auth import Principal, ensure_project, project_for, role_in
from drymem_server.db.models import (
    ROLE_LEAD,
    ROLE_MEMBER,
    SCOPE_PRIVATE,
    SCOPE_TEAM,
    AuditLog,
    Memory,
    MemoryFeedback,
    Project,
    Skill,
    User,
)
from drymem_server.identity import group_id_private, group_id_team, sanitize_group_id
from drymem_server.memory_store import Episode, Fact, MemoryStore, Metadata
from drymem_server.schema import DEFAULT_TYPE, normalize_type
from drymem_server.scrubber import ScrubResult, scrub
from drymem_server.settings import settings

_TITLE_LIMIT = 500


def denylist() -> list[str]:
    return [x for x in settings.scrub_denylist.split(",") if x.strip()]


def _title_from(name: str, body: str) -> str:
    """A human-readable label for the index, so listing memories needs no graph.

    Skips YAML frontmatter. An imported memory file starts with `---`, and
    taking the first non-empty line gave every one of them the title "---".
    """
    lines = body.splitlines()
    start = 0
    if lines and lines[0].strip() == "---":
        closing = next((i for i, line in enumerate(lines[1:], 1) if line.strip() == "---"), None)
        if closing is not None:
            start = closing + 1

    for line in lines[start:]:
        stripped = line.strip().lstrip("#").strip().strip("*")
        if stripped and stripped != "---":
            return stripped[:_TITLE_LIMIT]
    return name[:_TITLE_LIMIT]


@dataclass(frozen=True)
class Entry:
    """An episode plus what the index knows about it.

    The graph holds the text; Postgres holds the title a person reads, the kind
    of memory it is, when it was shared and how it was rated. A reader needs
    both, and fetching them separately is what made the UI show a topic key
    where a title belongs.
    """

    episode: Episode
    title: str = ""
    memory_type: str = DEFAULT_TYPE
    session_id: str = ""
    topic_key: str = ""
    promoted_at: datetime | None = None
    rating: int | None = None


class LastMemberError(Exception):
    """Raised rather than leaving a project nobody can open."""


class Forbidden(Exception):
    """The caller is who they say they are and still may not do this.

    Raised from the service, not checked in the UI: a hidden button is not a
    permission (PLAN.md D31).
    """


@dataclass(frozen=True)
class Overview:
    """What a project looks like at a glance."""

    memories: int
    shared: int
    sessions: int
    members: int
    skills: int
    positive: int
    negative: int
    by_type: dict[str, int]


@dataclass(frozen=True)
class SessionSummary:
    """One sitting: the memories that came out of a single agent run."""

    session_id: str
    author: str
    memory_count: int
    started_at: datetime
    ended_at: datetime
    titles: list[str]
    shared: int = 0
    # True when the id was derived from author and day rather than recorded.
    synthetic: bool = False


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

    async def _require_lead(self, project: Project) -> None:
        """Changing what a project uses or who is on it takes a lead or an org admin."""
        role = await role_in(self.session, self.principal, project)
        if role != ROLE_LEAD:
            raise Forbidden("Only a project lead or an organisation admin can do that.")

    def _require_admin(self) -> None:
        if not self.principal.is_admin:
            raise Forbidden("Only an organisation admin can do that.")

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
        memory_type: str | None = None,
        session_id: str | None = None,
    ) -> SavedMemory:
        # Scrub first. Everything after this point either stores the text or
        # sends it to a model, and both are too late to take a secret back.
        cleaned = scrub(body, denylist())

        kind = normalize_type(memory_type)
        project = await ensure_project(self.session, self.principal, project_key)
        metadata = Metadata(
            project_key=project_key,
            author=self.principal.email,
            tool=tool,
            scope=SCOPE_PRIVATE,
            memory_type=kind,
            session_id=session_id or "",
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
            memory_type=kind,
            session_id=session_id or None,
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
        """Recent memories, team first, each appearing once.

        The session-start hook has a budget of a few hundred tokens. Spending it
        on your own half-finished note when a teammate has already vouched for
        an answer is the wrong trade — and spending it *twice* on the same note
        is worse, which is what happened before the dedupe: promotion copies an
        episode into the team group, so the author read both groups and got the
        memory back two times.
        """
        episodes = await self.store.recent(
            group_ids=await self.readable_groups(project_key), limit=limit * 2
        )

        # Same name and same text is the same memory. The team copy wins,
        # because "shared" is the more useful of the two things to be told.
        by_identity: dict[tuple[str, str], Episode] = {}
        for episode in episodes:
            key = (episode.name, episode.content)
            current = by_identity.get(key)
            shared = episode.metadata is not None and episode.metadata.scope == SCOPE_TEAM
            if current is None or (shared and not self._is_shared(current)):
                by_identity[key] = episode

        unique = sorted(
            by_identity.values(),
            key=lambda e: e.created_at or datetime.min.replace(tzinfo=UTC),
            reverse=True,
        )
        shared = [e for e in unique if self._is_shared(e)]
        own = [e for e in unique if not self._is_shared(e)]
        return (shared + own)[:limit]

    @staticmethod
    def _is_shared(episode: Episode) -> bool:
        return episode.metadata is not None and episode.metadata.scope == SCOPE_TEAM

    async def entries(self, *, project_key: str, limit: int) -> list[Entry]:
        """Recent memories with their index rows attached.

        One query for every uuid in the page rather than one per memory: the
        list view is the most-hit read in the product and N+1 on it is the
        difference between instant and noticeable.
        """
        episodes = await self.context(project_key=project_key, limit=limit)
        if not episodes:
            return []

        uuids = [e.uuid for e in episodes]
        rows = await self.session.execute(
            select(
                Memory,
                func.coalesce(func.sum(MemoryFeedback.rating), 0),
            )
            .outerjoin(MemoryFeedback, MemoryFeedback.memory_id == Memory.id)
            .where(
                Memory.org_id == self.principal.org_id,
                (Memory.episode_uuid.in_(uuids)) | (Memory.team_episode_uuid.in_(uuids)),
            )
            .group_by(Memory.id)
        )

        index: dict[str, tuple[Memory, int]] = {}
        for memory, score in rows.all():
            index[memory.episode_uuid] = (memory, score)
            if memory.team_episode_uuid:
                index[memory.team_episode_uuid] = (memory, score)

        out: list[Entry] = []
        for episode in episodes:
            found = index.get(episode.uuid)
            meta = episode.metadata
            if found is None:
                # Written straight to the graph — a backfill has not run yet.
                out.append(
                    Entry(
                        episode=episode,
                        title=episode.name,
                        memory_type=meta.memory_type if meta else DEFAULT_TYPE,
                        session_id=meta.session_id if meta else "",
                    )
                )
                continue
            memory, score = found
            out.append(
                Entry(
                    episode=episode,
                    title=memory.title,
                    memory_type=memory.memory_type,
                    session_id=memory.session_id or (meta.session_id if meta else ""),
                    topic_key=memory.topic_key or "",
                    promoted_at=memory.promoted_at,
                    rating=None if score == 0 else (1 if score > 0 else -1),
                )
            )
        return out

    async def episodes_for_topic(self, *, project_key: str, topic_key: str) -> list[Episode]:
        recent = await self.context(project_key=project_key, limit=50)
        return [
            ep
            for ep in recent
            if ep.name == topic_key or ep.name.startswith(f"{topic_key}/update-")
        ]

    async def discover(self, *, project_key: str, min_memories: int) -> list[dict]:
        """Subjects this project's memories keep returning to."""
        from drymem_server.discover import clusters_for

        groups = await self.readable_groups(project_key)
        members = await self.members(project_key=project_key) or []
        people = [u.email for u, _ in members] + [u.name for u, _ in members if u.name]
        return [
            c.as_dict()
            for c in await clusters_for(groups, min_memories=min_memories, people=people)
        ]

    async def distill(self, *, project_key: str, topic: str):
        """Draft a skill from the memories about `topic`. Returns None if there are none."""
        from drymem_server.discover import memories_about
        from drymem_server.distill import draft_skill

        groups = await self.readable_groups(project_key)
        memories = await memories_about(groups, topic)
        if not memories:
            return None
        return await draft_skill(topic, memories)

    async def topic_keys(self, *, project_key: str) -> list[str]:
        """Every topic key this caller has already stored in a project.

        Import needs this to be idempotent, and reading it from the index is
        both exact and cheap — paging the graph would cap out and make a second
        import silently duplicate whatever fell outside the window.
        """
        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return []
        rows = await self.session.execute(
            select(Memory.topic_key).where(
                Memory.project_id == project.id, Memory.topic_key.is_not(None)
            )
        )
        return sorted({key for key in rows.scalars() if key})

    async def delete(self, *, episode_uuid: str) -> bool:
        """Remove an episode, and its index row.

        Scoped to the caller's org: a uuid from another tenant is simply not
        found, so knowing a uuid is not enough to delete someone else's memory.
        """
        result = await self.session.execute(
            select(Memory).where(
                (Memory.episode_uuid == episode_uuid) | (Memory.team_episode_uuid == episode_uuid),
                Memory.org_id == self.principal.org_id,
            )
        )
        row = result.scalar_one_or_none()
        if row is None:
            return False

        await self.store.delete(episode_uuid)
        # A promoted memory lives in two groups. Deleting only the one the
        # caller named would leave the shared copy readable by the whole team
        # after its author believed they had removed it.
        for other in (row.episode_uuid, row.team_episode_uuid):
            if other and other != episode_uuid:
                await self.store.delete(other)
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
                (Memory.episode_uuid == episode_uuid) | (Memory.team_episode_uuid == episode_uuid),
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

        copy = await self.store.save(
            name=original.name,
            body=original.content,
            group_id=group_id_team(project.project_key),
            metadata=Metadata(
                project_key=project.project_key,
                author=self.principal.email,
                tool=memory.tool,
                scope=SCOPE_TEAM,
                memory_type=memory.memory_type,
                session_id=memory.session_id or "",
            ),
        )

        memory.team_episode_uuid = copy.uuid
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
                (Memory.episode_uuid == episode_uuid) | (Memory.team_episode_uuid == episode_uuid),
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
        await self._require_lead(project)

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

    async def graph(
        self, *, project_key: str, limit: int, kinds: list[str] | None, author: str | None
    ):
        """The knowledge graph, for the canvas. Only groups this caller may read."""
        from drymem_server import graph_view

        groups = await self.readable_groups(project_key)
        return await graph_view.build(groups=groups, limit=limit, kinds=kinds, author=author)

    async def ask(self, *, project_key: str, question: str, limit: int = 6):
        """Answer from this project's memories, with citations.

        Retrieval is two passes because the two halves fail differently: the
        graph search finds a *subject* the question names, and recency finds
        what was written about it lately. A question about "the payment
        component" that matches no entity would otherwise return nothing at all,
        even when three memories last week are about exactly that.
        """
        from drymem_server import ask as ask_module

        entries = await self.entries(project_key=project_key, limit=40)
        if not entries:
            return await ask_module.answer(question=question, sources=[], bodies={})

        facts = await self.search(project_key=project_key, query=question, limit=10)
        # `Fact.name` is the episode's name, which is how a hit points back at
        # the memory it came from.
        named = {f.name for f in facts}

        words = {w for w in question.lower().split() if len(w) > 3}

        def score(entry) -> tuple[int, int]:
            episode = entry.episode
            text = f"{entry.title} {episode.name} {episode.content[:2000]}".lower()
            return (
                1 if episode.name in named else 0,
                sum(1 for w in words if w in text),
            )

        ranked = sorted(entries, key=score, reverse=True)
        picked = [e for e in ranked if any(score(e))][: ask_module.MAX_SOURCES]
        if not picked:
            picked = ranked[: ask_module.MAX_SOURCES]

        sources = [
            ask_module.Source(
                index=i,
                uuid=entry.episode.uuid,
                title=entry.title or entry.episode.name,
                author=entry.episode.metadata.author if entry.episode.metadata else "",
                created_at=entry.episode.created_at,
                memory_type=entry.memory_type,
                scope=entry.episode.metadata.scope if entry.episode.metadata else "private",
            )
            for i, entry in enumerate(picked, start=1)
        ]
        bodies = {e.episode.uuid: e.episode.content for e in picked}
        return await ask_module.answer(question=question, sources=sources, bodies=bodies)

    async def capture_mode(self, *, project_key: str) -> str:
        """How this project wants sessions captured. See PLAN.md D38."""
        from drymem_server.db.models import CAPTURE_AUTOMATIC

        project = await project_for(self.session, self.principal, project_key)
        return project.capture_mode if project else CAPTURE_AUTOMATIC

    # ---- the management surface: sessions, people, skills -------------------

    async def sessions(self, *, project_key: str, limit: int = 50) -> list[SessionSummary]:
        """A project's memories grouped into the sittings that produced them.

        Memories saved before sessions existed have no id, so they are grouped
        by author and day and marked `synthetic`. Inventing a session id for
        them would make a guess indistinguishable from a fact; saying "grouped
        by day" costs one boolean and stays true.
        """
        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return []

        rows = await self.session.execute(
            select(Memory, User.email)
            .join(User, User.id == Memory.author_id)
            .where(Memory.project_id == project.id)
            .order_by(Memory.created_at.desc())
        )

        groups: dict[str, list[tuple[Memory, str]]] = {}
        synthetic: set[str] = set()
        for memory, email in rows.all():
            if memory.session_id:
                key = memory.session_id
            else:
                key = f"{email}@{memory.created_at.date().isoformat()}"
                synthetic.add(key)
            groups.setdefault(key, []).append((memory, email))

        summaries = [
            SessionSummary(
                session_id=key,
                author=items[0][1],
                memory_count=len(items),
                started_at=min(m.created_at for m, _ in items),
                ended_at=max(m.created_at for m, _ in items),
                titles=[m.title for m, _ in items][:6],
                shared=sum(1 for m, _ in items if m.scope == SCOPE_TEAM),
                synthetic=key in synthetic,
            )
            for key, items in groups.items()
        ]
        summaries.sort(key=lambda x: x.ended_at, reverse=True)
        return summaries[:limit]

    async def me(self) -> User | None:
        return await self.session.get(User, self.principal.user_id)

    async def rename_me(self, *, name: str) -> User | None:
        user = await self.me()
        if user is None:
            return None
        user.name = name.strip() or None
        await self.session.flush()
        return user

    async def rename_project(self, *, project_key: str, display_name: str) -> Project | None:
        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return None
        await self._require_lead(project)
        project.display_name = display_name.strip() or None
        self.audit("project.rename", f"{project_key}:{display_name}")
        await self.session.flush()
        return project

    async def set_member_role(
        self, *, project_key: str, email: str, role: str
    ) -> list[tuple[User, str]] | None:
        from drymem_server.db.models import ProjectMember

        project = await project_for(self.session, self.principal, project_key)
        if project is None or role not in (ROLE_MEMBER, ROLE_LEAD):
            return None
        await self._require_lead(project)

        member = (
            await self.session.execute(
                select(ProjectMember)
                .join(User, User.id == ProjectMember.user_id)
                .where(ProjectMember.project_id == project.id, User.email == email)
            )
        ).scalar_one_or_none()
        if member is None:
            return None

        member.role = role
        self.audit("project.set_role", f"{project_key}:{email}:{role}")
        await self.session.flush()
        return await self.members(project_key=project_key)

    async def remove_member(self, *, project_key: str, email: str) -> list[tuple[User, str]] | None:
        """Take someone off a project. Their memories stay theirs.

        Removing the last member is refused: a project with nobody on it cannot
        be opened by anyone, including whoever would need to fix that.
        """
        from drymem_server.db.models import ProjectMember

        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return None
        await self._require_lead(project)

        current = await self.members(project_key=project_key) or []
        if len(current) <= 1:
            raise LastMemberError("A project must keep at least one member.")

        member = (
            await self.session.execute(
                select(ProjectMember)
                .join(User, User.id == ProjectMember.user_id)
                .where(ProjectMember.project_id == project.id, User.email == email)
            )
        ).scalar_one_or_none()
        if member is None:
            return None

        await self.session.delete(member)
        self.audit("project.remove_member", f"{project_key}:{email}")
        await self.session.flush()
        return await self.members(project_key=project_key)

    async def overview(self, *, project_key: str) -> Overview | None:
        """The numbers the dashboard opens with, in one round trip."""
        from drymem_server.db.models import ProjectMember

        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return None

        rows = await self.session.execute(
            select(Memory.memory_type, Memory.scope, func.count(Memory.id))
            .where(Memory.project_id == project.id)
            .group_by(Memory.memory_type, Memory.scope)
        )
        by_type: dict[str, int] = {}
        total = shared = 0
        for kind, scope, n in rows.all():
            by_type[kind] = by_type.get(kind, 0) + n
            total += n
            if scope == SCOPE_TEAM:
                shared += n

        sessions = await self.session.execute(
            select(func.count(func.distinct(Memory.session_id))).where(
                Memory.project_id == project.id, Memory.session_id.is_not(None)
            )
        )
        members = await self.session.execute(
            select(func.count(ProjectMember.id)).where(ProjectMember.project_id == project.id)
        )
        skills = await self.session.execute(
            select(func.count(Skill.id)).where(Skill.project_id == project.id)
        )
        votes = await self.session.execute(
            select(
                func.count(case((MemoryFeedback.rating > 0, 1))),
                func.count(case((MemoryFeedback.rating < 0, 1))),
            )
            .join(Memory, Memory.id == MemoryFeedback.memory_id)
            .where(Memory.project_id == project.id)
        )
        positive, negative = votes.one()

        return Overview(
            memories=total,
            shared=shared,
            sessions=sessions.scalar() or 0,
            members=members.scalar() or 0,
            skills=skills.scalar() or 0,
            positive=positive or 0,
            negative=negative or 0,
            by_type=by_type,
        )

    async def org_users(self) -> list[tuple[User, int, int]]:
        """Everyone in this org, with what they have contributed.

        Org-wide rather than project-wide because this is the screen you open to
        add someone to a project, and you cannot add a person you cannot see.
        Only counts are exposed — never anyone's private memory.
        """
        from drymem_server.db.models import ProjectMember

        rows = await self.session.execute(
            select(
                User,
                func.count(func.distinct(Memory.id)),
                func.count(func.distinct(ProjectMember.project_id)),
            )
            .outerjoin(Memory, Memory.author_id == User.id)
            .outerjoin(ProjectMember, ProjectMember.user_id == User.id)
            .where(User.org_id == self.principal.org_id)
            .group_by(User.id)
            .order_by(User.email)
        )
        return [tuple(row) for row in rows.all()]

    async def skills(self, *, project_key: str) -> list[tuple[Skill, str]]:
        """Skills published to a project, newest first."""
        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return []
        rows = await self.session.execute(
            select(Skill, User.email)
            .join(User, User.id == Skill.author_id)
            .where(Skill.project_id == project.id)
            .order_by(Skill.updated_at.desc())
        )
        return [(skill, email) for skill, email in rows.all()]

    async def publish_skill(
        self,
        *,
        project_key: str,
        name: str,
        topic: str,
        content: str,
        model: str | None,
        memory_count: int,
    ) -> Skill | None:
        """Publish a distilled draft to the project, or replace the one there.

        Republishing overwrites rather than duplicating: a skill is the team's
        current answer to a subject, and two answers to one subject is the state
        the product exists to prevent.
        """
        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return None
        await self._require_lead(project)

        cleaned = scrub(content, denylist())
        existing = (
            await self.session.execute(
                select(Skill).where(Skill.project_id == project.id, Skill.name == name)
            )
        ).scalar_one_or_none()

        if existing is not None:
            existing.content = cleaned.text
            existing.topic = topic
            existing.model = model
            existing.memory_count = memory_count
            existing.author_id = self.principal.user_id
            self.audit("skill.update", f"{project_key}:{name}")
            await self.session.flush()
            return existing

        skill = Skill(
            org_id=self.principal.org_id,
            project_id=project.id,
            author_id=self.principal.user_id,
            name=name,
            topic=topic,
            content=cleaned.text,
            model=model,
            memory_count=memory_count,
        )
        self.session.add(skill)
        self.audit("skill.publish", f"{project_key}:{name}")
        await self.session.flush()
        return skill

    async def delete_skill(self, *, project_key: str, name: str) -> bool:
        project = await project_for(self.session, self.principal, project_key)
        if project is None:
            return False
        await self._require_lead(project)
        skill = (
            await self.session.execute(
                select(Skill).where(Skill.project_id == project.id, Skill.name == name)
            )
        ).scalar_one_or_none()
        if skill is None:
            return False
        await self.session.delete(skill)
        self.audit("skill.delete", f"{project_key}:{name}")
        await self.session.flush()
        return True

    @staticmethod
    def timestamp() -> str:
        return datetime.now(UTC).strftime("%Y%m%dT%H%M%S")
