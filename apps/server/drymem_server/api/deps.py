"""
FastAPI dependencies: who the caller is, and the memory store.

This service does not authenticate anybody. It sits behind the control plane
(`apps/api`), which is the only thing a browser or a CLI ever talks to, and
which passes a short-lived JWT naming the caller in `X-Drymem-Principal`. That
token is signed with a secret the two share and expires in ninety seconds, so a
leaked one is worthless before it can be used.

The alternative — this service reading the sessions and tokens tables too —
would put identity in two codebases and guarantee they drift.
"""

from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from drymem_server.auth import Principal
from drymem_server.db.session import get_session
from drymem_server.memory_store import GraphitiMemoryStore, MemoryStore
from drymem_server.service import MemoryService
from drymem_server.settings import settings

PRINCIPAL_HEADER = "x-drymem-principal"

_store: MemoryStore = GraphitiMemoryStore()

UNAUTHENTICATED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="This endpoint is reached through the drymem API.",
)


def set_store(store: MemoryStore) -> None:
    """Swap the backend. Tests use this; nothing else should."""
    global _store
    _store = store


def get_store() -> MemoryStore:
    return _store


def decode_principal(token: str) -> Principal:
    """Verify the control plane's assertion. Any doubt is a refusal."""
    try:
        claims = jwt.decode(
            token,
            settings.service_secret,
            algorithms=["HS256"],
            issuer="drymem-api",
            audience="drymem-memory",
        )
    except jwt.PyJWTError as exc:  # expired, wrong secret, wrong audience, malformed
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Bad principal: {exc}") from exc

    import uuid as _uuid

    try:
        user_id = _uuid.UUID(str(claims["userId"]))
        org_id = _uuid.UUID(str(claims["orgId"]))
    except (KeyError, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Bad principal.") from exc

    return Principal(
        user_id=user_id,
        org_id=org_id,
        email=str(claims.get("email", "")),
        role=str(claims.get("role", "member")),
    )


async def current_principal(
    x_drymem_principal: Annotated[str | None, Header()] = None,
) -> Principal:
    if not x_drymem_principal:
        raise UNAUTHENTICATED
    return decode_principal(x_drymem_principal)


async def memory_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    principal: Annotated[Principal, Depends(current_principal)],
) -> MemoryService:
    return MemoryService(session=session, store=get_store(), principal=principal)


ServiceDep = Annotated[MemoryService, Depends(memory_service)]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
PrincipalDep = Annotated[Principal, Depends(current_principal)]
