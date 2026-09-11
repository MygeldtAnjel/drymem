"""Async engine and session factory."""

from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from drymem_server.settings import settings


@lru_cache(maxsize=4)
def sessionmaker_for(url: str) -> async_sessionmaker[AsyncSession]:
    """One engine per URL, cached — tests point this at a scratch database."""
    engine = create_async_engine(url, pool_pre_ping=True, future=True)
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, rolled back on error."""
    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
