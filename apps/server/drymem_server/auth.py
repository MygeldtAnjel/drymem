"""
API tokens and access control.

Tokens are 32 bytes of `secrets.token_bytes`, so guessing one is not a threat
model. That is why they are stored as a plain SHA-256 and not bcrypt or argon2:
those exist to make guessing *low-entropy* passwords slow, and here they would
only add latency to every request while defending against nothing.

The plaintext is returned once, at creation, and never stored.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from drymem_server.db.models import ApiToken, Project, ProjectMember, User

TOKEN_PREFIX = "drymem_"
_TOKEN_BYTES = 32


@dataclass(frozen=True)
class Principal:
    """Who is making this request."""

    user_id: object
    org_id: object
    email: str


def generate_token() -> tuple[str, str]:
    """Return (plaintext, hash). The plaintext is shown once and not stored."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(_TOKEN_BYTES)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def looks_like_token(raw: str) -> bool:
    return raw.startswith(TOKEN_PREFIX) and len(raw) > len(TOKEN_PREFIX) + 20


async def authenticate(session: AsyncSession, raw: str | None) -> Principal | None:
    """Resolve a bearer token to a principal, or None.

    Returns None for every failure — missing, malformed, unknown, revoked — so
    the caller cannot distinguish "no such token" from "revoked token".
    """
    if not raw or not looks_like_token(raw):
        return None

    result = await session.execute(
        select(ApiToken)
        .where(ApiToken.token_hash == hash_token(raw))
        .options(selectinload(ApiToken.user))
    )
    token = result.scalar_one_or_none()
    if token is None or not token.active or token.user is None:
        return None

    token.last_used_at = datetime.now(UTC)
    return Principal(user_id=token.user.id, org_id=token.user.org_id, email=token.user.email)


async def project_for(
    session: AsyncSession, principal: Principal, project_key: str
) -> Project | None:
    """The project, only if this principal is a member of it.

    A caller who is not a member gets None, and the API turns that into 404
    rather than 403: a 403 would confirm that the project exists, which leaks
    one org's project names to another.
    """
    result = await session.execute(
        select(Project)
        .join(ProjectMember, ProjectMember.project_id == Project.id)
        .where(
            Project.project_key == project_key,
            Project.org_id == principal.org_id,
            ProjectMember.user_id == principal.user_id,
        )
    )
    return result.scalar_one_or_none()


async def ensure_project(session: AsyncSession, principal: Principal, project_key: str) -> Project:
    """Get the caller's project, creating it and their membership if new.

    A developer running `drymem save` in a repo nobody has registered should not
    have to file a ticket to get a project. First write wins and the author is
    its first member; step 3A adds inviting others.
    """
    project = await project_for(session, principal, project_key)
    if project is not None:
        return project

    existing = await session.execute(
        select(Project).where(
            Project.project_key == project_key, Project.org_id == principal.org_id
        )
    )
    project = existing.scalar_one_or_none()
    if project is None:
        project = Project(org_id=principal.org_id, project_key=project_key)
        session.add(project)
        await session.flush()

    session.add(ProjectMember(project_id=project.id, user_id=principal.user_id))
    await session.flush()
    return project


async def create_token(
    session: AsyncSession, user: User, label: str | None = None
) -> tuple[str, ApiToken]:
    raw, hashed = generate_token()
    token = ApiToken(user_id=user.id, token_hash=hashed, label=label)
    session.add(token)
    await session.flush()
    return raw, token
