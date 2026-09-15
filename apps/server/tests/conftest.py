"""
Shared fixtures.

Integration tests run against a real Postgres (a scratch database created and
dropped per run) with the fake extractor, so no model is needed. Testing against
SQLite would prove nothing: the schema uses Postgres UUID columns and the ACL
relies on real joins.

The engine authenticates nobody. `auth()` mints the same signed assertion the
control plane sends, which is exactly what a request from it looks like.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from drymem_server.api.app import create_app
from drymem_server.api.deps import PRINCIPAL_HEADER, get_session, set_store
from drymem_server.db.models import ORG_OWNER, Base, Org, User
from drymem_server.memory_store import Episode, Fact, SaveResult
from drymem_server.settings import settings

ADMIN_URL = settings.database_url.rsplit("/", 1)[0] + "/postgres"


class InMemoryStore:
    """A MemoryStore that keeps everything in a dict.

    The API's job is auth, scrubbing, ordering and indexing; none of that needs
    a graph. The real store is covered by the e2e tests.
    """

    def __init__(self):
        self.episodes: dict[str, list[Episode]] = {}
        self.facts: list[Fact] = []
        self.deleted: list[str] = []
        self.saved_bodies: list[str] = []
        self.superseded: list[tuple[str, list[str]]] = []
        self._tick = 0

    async def search_episodes(self, *, query, group_ids, limit) -> list[Episode]:
        """Substring over content, which is what the full-text index approximates."""
        needle = query.strip().lower()
        out: list[Episode] = []
        for group in group_ids:
            for episode in self.episodes.get(group, []):
                if needle and needle in (episode.content or "").lower():
                    out.append(episode)
        return out[:limit]

    async def link_supersedes(self, *, newer: str, older: list[str]) -> int:
        kept = [o for o in older if o != newer]
        if kept:
            self.superseded.append((newer, kept))
        return len(kept)

    async def save(self, *, name, body, group_id, metadata) -> SaveResult:
        episode_uuid = str(uuid.uuid4())
        self.saved_bodies.append(body)
        # A real episode is stamped when it is written, and the double left it
        # None — so every cursor derived from it was None and paging could not
        # be tested at all. Each save is a tick apart because a test writes five
        # memories faster than a clock moves, and identical timestamps make a
        # time cursor ambiguous.
        self._tick += 1
        self.episodes.setdefault(group_id, []).insert(
            0,
            Episode(
                uuid=episode_uuid,
                name=name,
                content=body,
                created_at=datetime.now(UTC) + timedelta(milliseconds=self._tick),
                metadata=metadata,
            ),
        )
        return SaveResult(uuid=episode_uuid, entity_count=2, edge_count=1)

    async def search(self, *, query, group_ids, limit):
        return self.facts[:limit]

    async def recent(self, *, group_ids, limit, before=None, before_uuid=None):
        # The cursor is honoured, and inclusively — like Graphiti's
        # `reference_time`. A double that filtered exclusively would hide the
        # duplicate-on-every-boundary bug that only real data exposed.
        out: list[Episode] = []
        for gid in group_ids:
            out.extend(self.episodes.get(gid, []))
        if before is not None:
            out = [e for e in out if e.created_at and e.created_at <= before]
        if before_uuid is not None:
            out = [e for e in out if e.uuid != before_uuid]
        out.sort(key=lambda e: e.created_at or datetime.min.replace(tzinfo=UTC), reverse=True)
        return out[:limit]

    async def delete(self, episode_id: str) -> None:
        self.deleted.append(episode_id)
        for episodes in self.episodes.values():
            episodes[:] = [e for e in episodes if e.uuid != episode_id]


@pytest_asyncio.fixture
async def db_url():
    """A scratch database per test, dropped afterwards."""
    name = f"drymem_test_{uuid.uuid4().hex[:10]}"
    admin = create_async_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        await conn.exec_driver_sql(f'CREATE DATABASE "{name}"')
    await admin.dispose()

    url = settings.database_url.rsplit("/", 1)[0] + f"/{name}"
    engine = create_async_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()

    yield url

    admin = create_async_engine(ADMIN_URL, isolation_level="AUTOCOMMIT")
    async with admin.connect() as conn:
        await conn.exec_driver_sql(
            f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='{name}'"
        )
        await conn.exec_driver_sql(f'DROP DATABASE IF EXISTS "{name}"')
    await admin.dispose()


@pytest_asyncio.fixture
async def sessionmaker(db_url):
    engine = create_async_engine(db_url)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


@pytest_asyncio.fixture
async def store():
    s = InMemoryStore()
    set_store(s)
    return s


@pytest_asyncio.fixture
async def world(sessionmaker):
    """Two orgs, three users, tokens for each. The shape every authz test needs."""
    async with sessionmaker() as session:
        acme = Org(name="Acme", slug="acme")
        other = Org(name="Other", slug="other")
        session.add_all([acme, other])
        await session.flush()

        miguel = User(org_id=acme.id, email="miguel@acme.test", name="Miguel", role=ORG_OWNER)
        jose = User(org_id=acme.id, email="jose@acme.test", name="Jose")
        outsider = User(
            org_id=other.id, email="outsider@other.test", name="Outsider", role=ORG_OWNER
        )
        session.add_all([miguel, jose, outsider])
        await session.flush()

        await session.commit()
        return {
            "people": {
                "miguel": (miguel.id, acme.id, miguel.email, ORG_OWNER),
                "jose": (jose.id, acme.id, jose.email, "member"),
                "outsider": (outsider.id, other.id, outsider.email, ORG_OWNER),
            }
        }


@pytest_asyncio.fixture
async def client(sessionmaker, store, world):
    app = create_app()

    async def override_session():
        async with sessionmaker() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    app.dependency_overrides[get_session] = override_session
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        ac.world = world
        ac.sessionmaker = sessionmaker
        yield ac


def auth(client, who="miguel") -> dict[str, str]:
    """The header the control plane sends: a signed, short-lived principal."""
    user_id, org_id, email, role = client.world["people"][who]
    token = jwt.encode(
        {
            "userId": str(user_id),
            "orgId": str(org_id),
            "email": email,
            "role": role,
            "iss": "drymem-api",
            "aud": "drymem-memory",
            "exp": datetime.now(UTC) + timedelta(minutes=5),
        },
        settings.service_secret,
        algorithm="HS256",
    )
    return {PRINCIPAL_HEADER: token}


async def add_member(sessionmaker, project_key: str, who_id, role: str = "member") -> None:
    """Put someone on a project.

    Membership is the control plane's to grant now, so the engine's tests set it
    up directly rather than through an endpoint this service no longer has.
    """
    from sqlalchemy import select

    from drymem_server.db.models import Project, ProjectMember

    async with sessionmaker() as session:
        project = (
            await session.execute(select(Project).where(Project.project_key == project_key))
        ).scalar_one()
        exists = (
            await session.execute(
                select(ProjectMember).where(
                    ProjectMember.project_id == project.id, ProjectMember.user_id == who_id
                )
            )
        ).scalar_one_or_none()
        if exists is None:
            session.add(ProjectMember(project_id=project.id, user_id=who_id, role=role))
            await session.commit()
