"""
Shared fixtures.

Integration tests run against a real Postgres (a scratch database created and
dropped per run) and a real Neo4j, with the fake extractor so no model is
needed. Testing the API against SQLite would prove nothing: the schema uses
Postgres UUID columns and the ACL relies on real joins.
"""

from __future__ import annotations

import uuid

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from drymem_server.api.app import create_app
from drymem_server.api.deps import get_session, set_store
from drymem_server.auth import create_token
from drymem_server.db.models import Base, Org, User
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

    async def save(self, *, name, body, group_id, metadata) -> SaveResult:
        episode_uuid = str(uuid.uuid4())
        self.saved_bodies.append(body)
        self.episodes.setdefault(group_id, []).insert(
            0, Episode(uuid=episode_uuid, name=name, content=body, metadata=metadata)
        )
        return SaveResult(uuid=episode_uuid, entity_count=2, edge_count=1)

    async def search(self, *, query, group_ids, limit):
        return self.facts[:limit]

    async def recent(self, *, group_ids, limit):
        out: list[Episode] = []
        for gid in group_ids:
            out.extend(self.episodes.get(gid, []))
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

        miguel = User(org_id=acme.id, email="miguel@acme.test", name="Miguel")
        jose = User(org_id=acme.id, email="jose@acme.test", name="Jose")
        outsider = User(org_id=other.id, email="outsider@other.test", name="Outsider")
        session.add_all([miguel, jose, outsider])
        await session.flush()

        tokens = {}
        for user, key in ((miguel, "miguel"), (jose, "jose"), (outsider, "outsider")):
            raw, _ = await create_token(session, user, label=key)
            tokens[key] = raw

        revoked_raw, revoked = await create_token(session, miguel, label="revoked")
        from datetime import UTC, datetime

        revoked.revoked_at = datetime.now(UTC)
        tokens["revoked"] = revoked_raw

        await session.commit()
        return {
            "tokens": tokens,
            "orgs": {"acme": acme.id, "other": other.id},
            "users": {"miguel": miguel.id, "jose": jose.id, "outsider": outsider.id},
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
        yield ac


def auth(client, who="miguel") -> dict[str, str]:
    return {"Authorization": f"Bearer {client.world['tokens'][who]}"}
