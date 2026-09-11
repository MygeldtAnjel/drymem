"""
Identity: passwords, browser sessions, API tokens, invites, device login.

Two kinds of credential reach the server. A **browser session** is a random
token in an httpOnly cookie, hashed in `web_sessions`, revocable. An **API
token** is what the CLI, the MCP proxy and the hooks send as a bearer; also
hashed, also revocable. Both resolve to the same `Principal`.

Tokens are 32 bytes of `secrets.token_bytes`, so guessing one is not a threat
model — which is why they are stored as a plain SHA-256 and not argon2. Argon2
exists to make guessing *low-entropy* secrets slow, and that is exactly what it
is used for here: passwords, and nothing else.
"""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from drymem_server.db.models import (
    ORG_ADMIN,
    ORG_MEMBER,
    ORG_OWNER,
    ROLE_LEAD,
    ApiToken,
    DeviceCode,
    Invite,
    Org,
    Project,
    ProjectMember,
    User,
    WebSession,
)
from drymem_server.settings import settings

TOKEN_PREFIX = "drymem_"
_TOKEN_BYTES = 32
_hasher = PasswordHasher()

MIN_PASSWORD = 10


class AuthError(Exception):
    """A refusal with a message safe to show the person who caused it."""


@dataclass(frozen=True)
class Principal:
    """Who is making this request, and what they may do in the org."""

    user_id: object
    org_id: object
    email: str
    role: str = ORG_MEMBER

    @property
    def is_admin(self) -> bool:
        return self.role in (ORG_OWNER, ORG_ADMIN)


def _now() -> datetime:
    return datetime.now(UTC)


# ---- passwords --------------------------------------------------------------


def hash_password(raw: str) -> str:
    if len(raw) < MIN_PASSWORD:
        raise AuthError(f"Use at least {MIN_PASSWORD} characters.")
    return _hasher.hash(raw)


def verify_password(stored: str | None, raw: str) -> bool:
    if not stored:
        return False
    try:
        return _hasher.verify(stored, raw)
    except VerificationError:
        return False


# ---- tokens (bearer) ----------------------------------------------------------


def generate_token() -> tuple[str, str]:
    """Return (plaintext, hash). The plaintext is shown once and not stored."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(_TOKEN_BYTES)
    return raw, hash_token(raw)


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def looks_like_token(raw: str) -> bool:
    return raw.startswith(TOKEN_PREFIX) and len(raw) > len(TOKEN_PREFIX) + 20


def _principal(user: User) -> Principal:
    return Principal(user_id=user.id, org_id=user.org_id, email=user.email, role=user.role)


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

    token.last_used_at = _now()
    return _principal(token.user)


async def create_token(
    session: AsyncSession, user: User, label: str | None = None
) -> tuple[str, ApiToken]:
    raw, hashed = generate_token()
    token = ApiToken(user_id=user.id, token_hash=hashed, label=label)
    session.add(token)
    await session.flush()
    return raw, token


# ---- browser sessions -----------------------------------------------------------


async def authenticate_session(session: AsyncSession, raw: str | None) -> Principal | None:
    """Resolve a session cookie to a principal, or None."""
    if not raw:
        return None
    result = await session.execute(
        select(WebSession).where(WebSession.token_hash == hash_token(raw))
    )
    web = result.scalar_one_or_none()
    if web is None or web.revoked_at is not None or web.expires_at < _now():
        return None

    user = await session.get(User, web.user_id)
    if user is None:
        return None

    web.last_seen_at = _now()
    return _principal(user)


async def create_session(
    session: AsyncSession, user: User, user_agent: str | None
) -> tuple[str, WebSession]:
    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    web = WebSession(
        user_id=user.id,
        token_hash=hash_token(raw),
        user_agent=(user_agent or "")[:300] or None,
        expires_at=_now() + timedelta(days=settings.session_days),
    )
    session.add(web)
    await session.flush()
    return raw, web


async def revoke_session(session: AsyncSession, raw: str | None) -> None:
    if not raw:
        return
    web = (
        await session.execute(select(WebSession).where(WebSession.token_hash == hash_token(raw)))
    ).scalar_one_or_none()
    if web is not None:
        web.revoked_at = _now()


async def login(
    session: AsyncSession, email: str, password: str, user_agent: str | None
) -> tuple[str, User]:
    """Password login. One error message for every failure, on purpose."""
    user = (
        await session.execute(select(User).where(func.lower(User.email) == email.lower()))
    ).scalar_one_or_none()
    if user is None or not verify_password(user.password_hash, password):
        raise AuthError("That email and password do not match.")
    raw, _ = await create_session(session, user, user_agent)
    return raw, user


# ---- first run and invites -------------------------------------------------------


async def needs_setup(session: AsyncSession) -> bool:
    """True until the first person signs up. That person owns the org."""
    count = (await session.execute(select(func.count(User.id)))).scalar() or 0
    return count == 0


async def bootstrap(
    session: AsyncSession, *, org_name: str, email: str, password: str, name: str | None
) -> User:
    """Create the organisation and its owner. Refused once anyone exists.

    Without the refusal, a server left open on a network would let the next
    visitor make themselves the owner.
    """
    if not await needs_setup(session):
        raise AuthError("This server already has an organisation. Ask for an invite.")

    slug = "".join(c if c.isalnum() else "-" for c in org_name.lower()).strip("-") or "org"
    org = Org(name=org_name.strip() or "My team", slug=slug)
    session.add(org)
    await session.flush()

    user = User(
        org_id=org.id,
        email=email.strip().lower(),
        name=(name or "").strip() or None,
        password_hash=hash_password(password),
        role=ORG_OWNER,
    )
    session.add(user)
    await session.flush()
    return user


async def create_invite(
    session: AsyncSession,
    *,
    inviter: Principal,
    email: str,
    role: str,
    project: Project | None,
) -> tuple[str, Invite]:
    """Invite by email. Returns the plaintext link token, shown once."""
    if role not in (ORG_ADMIN, ORG_MEMBER):
        raise AuthError("Role must be admin or member.")

    email = email.strip().lower()
    existing = (
        await session.execute(
            select(User).where(User.org_id == inviter.org_id, func.lower(User.email) == email)
        )
    ).scalar_one_or_none()
    if existing is not None and existing.password_hash:
        raise AuthError(f"{email} already has an account here.")

    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    invite = Invite(
        org_id=inviter.org_id,
        email=email,
        role=role,
        project_id=project.id if project else None,
        invited_by=inviter.user_id,
        token_hash=hash_token(raw),
        expires_at=_now() + timedelta(days=settings.invite_days),
    )
    session.add(invite)
    await session.flush()
    return raw, invite


async def find_invite(session: AsyncSession, raw: str) -> Invite | None:
    invite = (
        await session.execute(select(Invite).where(Invite.token_hash == hash_token(raw)))
    ).scalar_one_or_none()
    if invite is None or invite.accepted_at is not None or invite.expires_at < _now():
        return None
    return invite


async def accept_invite(
    session: AsyncSession, *, raw: str, password: str, name: str | None
) -> User:
    """Turn an invite into a user with a password, and a project membership if
    the invite named one. A user row created earlier by `drymem-admin` (no
    password yet) is claimed rather than duplicated."""
    invite = await find_invite(session, raw)
    if invite is None:
        raise AuthError("This invitation is no longer valid. Ask for a new one.")

    user = (
        await session.execute(
            select(User).where(User.org_id == invite.org_id, func.lower(User.email) == invite.email)
        )
    ).scalar_one_or_none()
    if user is None:
        user = User(org_id=invite.org_id, email=invite.email, role=invite.role)
        session.add(user)
    user.password_hash = hash_password(password)
    if name and name.strip():
        user.name = name.strip()
    # An invite can raise a member to admin. It must never lower an owner: the
    # break-glass `invite-link` for an existing account goes through here too.
    if invite.role == ORG_ADMIN and user.role == ORG_MEMBER:
        user.role = ORG_ADMIN
    await session.flush()

    if invite.project_id is not None:
        already = (
            await session.execute(
                select(ProjectMember).where(
                    ProjectMember.project_id == invite.project_id,
                    ProjectMember.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if already is None:
            session.add(ProjectMember(project_id=invite.project_id, user_id=user.id))

    invite.accepted_at = _now()
    await session.flush()
    return user


# ---- device login (`drymem login`) -------------------------------------------------


def _user_code() -> str:
    # No 0/O/1/I: it is read off one screen and typed into another.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    raw = "".join(secrets.choice(alphabet) for _ in range(8))
    return f"{raw[:4]}-{raw[4:]}"


async def start_device_login(session: AsyncSession, label: str | None) -> tuple[str, DeviceCode]:
    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    code = DeviceCode(
        device_hash=hash_token(raw),
        user_code=_user_code(),
        label=(label or "")[:200] or None,
        expires_at=_now() + timedelta(minutes=15),
    )
    session.add(code)
    await session.flush()
    return raw, code


async def approve_device_login(
    session: AsyncSession, *, principal: Principal, user_code: str
) -> DeviceCode:
    """The browser side. Mints an API token for the CLI that asked."""
    code = (
        await session.execute(
            select(DeviceCode).where(DeviceCode.user_code == user_code.strip().upper())
        )
    ).scalar_one_or_none()
    if code is None or code.status != "pending" or code.expires_at < _now():
        raise AuthError("That code is not valid any more. Run `drymem login` again.")

    user = await session.get(User, principal.user_id)
    if user is None:
        raise AuthError("No such user.")

    raw, _ = await create_token(session, user, label=code.label or "drymem login")
    code.status = "approved"
    code.user_id = user.id
    code.issued_token = raw
    await session.flush()
    return code


async def poll_device_login(session: AsyncSession, raw: str) -> tuple[str, str | None]:
    """The CLI side. Returns (status, token); the token is handed over once."""
    code = (
        await session.execute(select(DeviceCode).where(DeviceCode.device_hash == hash_token(raw)))
    ).scalar_one_or_none()
    if code is None or code.expires_at < _now():
        return "expired", None
    if code.status != "approved" or not code.issued_token:
        return code.status, None

    token = code.issued_token
    code.issued_token = None
    code.status = "collected"
    await session.flush()
    return "approved", token


# ---- projects and membership ---------------------------------------------------------


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


async def role_in(session: AsyncSession, principal: Principal, project: Project) -> str | None:
    """The caller's project role, or None if not a member. Org admins count as lead."""
    if principal.is_admin:
        return ROLE_LEAD
    result = await session.execute(
        select(ProjectMember.role).where(
            ProjectMember.project_id == project.id, ProjectMember.user_id == principal.user_id
        )
    )
    return result.scalar_one_or_none()


async def ensure_project(session: AsyncSession, principal: Principal, project_key: str) -> Project:
    """Get the caller's project, creating it and their membership if new.

    A developer running `drymem save` in a repo nobody has registered should not
    have to file a ticket to get a project. First write wins and the author is
    its first member — and its lead, since somebody has to be.
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
    first = project is None
    if project is None:
        project = Project(org_id=principal.org_id, project_key=project_key)
        session.add(project)
        await session.flush()

    session.add(
        ProjectMember(
            project_id=project.id,
            user_id=principal.user_id,
            role=ROLE_LEAD if first else "member",
        )
    )
    await session.flush()
    return project
