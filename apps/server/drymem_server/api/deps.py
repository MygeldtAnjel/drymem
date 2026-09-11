"""FastAPI dependencies: authentication, the store, the service."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from drymem_server.auth import Principal, authenticate
from drymem_server.db.session import get_session
from drymem_server.memory_store import GraphitiMemoryStore, MemoryStore
from drymem_server.service import MemoryService

_store: MemoryStore = GraphitiMemoryStore()

UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="A valid bearer token is required.",
    headers={"WWW-Authenticate": "Bearer"},
)


def set_store(store: MemoryStore) -> None:
    """Swap the backend. Tests use this; nothing else should."""
    global _store
    _store = store


def get_store() -> MemoryStore:
    return _store


async def current_principal(
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
) -> Principal:
    raw = None
    if authorization and authorization.lower().startswith("bearer "):
        raw = authorization[7:].strip()

    principal = await authenticate(session, raw)
    if principal is None:
        raise UNAUTHENTICATED
    return principal


async def memory_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    principal: Annotated[Principal, Depends(current_principal)],
) -> MemoryService:
    return MemoryService(session=session, store=get_store(), principal=principal)


ServiceDep = Annotated[MemoryService, Depends(memory_service)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
PrincipalDep = Annotated[Principal, Depends(current_principal)]
