"""FastAPI dependencies: authentication, the store, the service.

Two credentials are accepted. A bearer token is what the CLI, the MCP proxy and
the hooks send. A session cookie is what the browser sends. The cookie path
additionally requires an `X-Drymem-Client` header on anything that is not a
GET: with `SameSite=Lax` that header is what stops a form on another site from
posting into this API with the visitor's cookie, since a cross-site form cannot
set custom headers.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from drymem_server.auth import Principal, authenticate, authenticate_session
from drymem_server.db.session import get_session
from drymem_server.memory_store import GraphitiMemoryStore, MemoryStore
from drymem_server.service import MemoryService

SESSION_COOKIE = "drymem_session"
CLIENT_HEADER = "x-drymem-client"

_store: MemoryStore = GraphitiMemoryStore()

UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Sign in to continue.",
    headers={"WWW-Authenticate": "Bearer"},
)


def set_store(store: MemoryStore) -> None:
    """Swap the backend. Tests use this; nothing else should."""
    global _store
    _store = store


def get_store() -> MemoryStore:
    return _store


async def current_principal(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    authorization: Annotated[str | None, Header()] = None,
    drymem_session: Annotated[str | None, Cookie()] = None,
) -> Principal:
    if authorization and authorization.lower().startswith("bearer "):
        principal = await authenticate(session, authorization[7:].strip())
        if principal is None:
            raise UNAUTHENTICATED
        return principal

    if drymem_session:
        if request.method not in ("GET", "HEAD", "OPTIONS") and not request.headers.get(
            CLIENT_HEADER
        ):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Cross-site request refused.")
        principal = await authenticate_session(session, drymem_session)
        if principal is None:
            raise UNAUTHENTICATED
        return principal

    raise UNAUTHENTICATED


async def admin_principal(
    principal: Annotated[Principal, Depends(current_principal)],
) -> Principal:
    if not principal.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only an organisation admin can do that.")
    return principal


async def memory_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    principal: Annotated[Principal, Depends(current_principal)],
) -> MemoryService:
    return MemoryService(session=session, store=get_store(), principal=principal)


ServiceDep = Annotated[MemoryService, Depends(memory_service)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
PrincipalDep = Annotated[Principal, Depends(current_principal)]
AdminDep = Annotated[Principal, Depends(admin_principal)]
