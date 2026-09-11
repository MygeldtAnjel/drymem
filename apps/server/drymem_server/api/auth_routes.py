"""
`/auth/*`: how a person becomes a user and how a machine gets a token.

Everything the old token-paste screen did badly lives here instead. Sign-up is
only possible while the server has nobody on it; after that, the door is an
invitation. Invitation and reset links are *returned* to the admin who asked
for them when SMTP is not configured — a printed link that works beats an
email that was never sent.
"""

from __future__ import annotations

import socket
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from drymem_server.api.deps import (
    SESSION_COOKIE,
    AdminDep,
    PrincipalDep,
    SessionDep,
)
from drymem_server.auth import (
    AuthError,
    accept_invite,
    approve_device_login,
    bootstrap,
    create_invite,
    create_session,
    create_token,
    find_invite,
    hash_password,
    login,
    needs_setup,
    poll_device_login,
    project_for,
    revoke_session,
    start_device_login,
    verify_password,
)
from drymem_server.db.models import ApiToken, Invite, Org, Project, User, WebSession
from drymem_server.settings import settings

router = APIRouter(prefix="/auth", tags=["auth"])


# ---- schemas -------------------------------------------------------------------


class BootstrapOut(BaseModel):
    needs_setup: bool
    org_name: str | None = None
    smtp_enabled: bool = False


class SignupRequest(BaseModel):
    org_name: str = Field(..., min_length=1, max_length=200)
    email: str = Field(..., min_length=3, max_length=320)
    password: str = Field(..., min_length=1, max_length=200)
    name: str = Field("", max_length=200)


class LoginRequest(BaseModel):
    email: str
    password: str


class SessionOut(BaseModel):
    id: str
    email: str
    name: str | None
    role: str
    org_id: str
    org_name: str


class InviteRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    role: str = Field("member", description="member or admin")
    project_key: str | None = Field(None, description="Also add them to this project")


class InviteOut(BaseModel):
    id: str
    email: str
    role: str
    project_key: str | None = None
    invited_by: str | None = None
    expires_at: datetime
    # Only on creation, and only when there is no SMTP to send it.
    invite_url: str | None = None


class InvitePublicOut(BaseModel):
    email: str
    org_name: str
    project_key: str | None = None
    invited_by: str | None = None


class AcceptRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=200)
    name: str = Field("", max_length=200)


class PasswordRequest(BaseModel):
    current: str = ""
    new: str = Field(..., min_length=1, max_length=200)


class WebSessionOut(BaseModel):
    id: str
    user_agent: str | None
    created_at: datetime
    last_seen_at: datetime | None
    current: bool


class TokenOut(BaseModel):
    id: str
    label: str | None
    created_at: datetime
    last_used_at: datetime | None
    # Only on creation.
    token: str | None = None


class TokenRequest(BaseModel):
    label: str = Field("", max_length=200)


class DeviceStart(BaseModel):
    label: str = Field("", max_length=200)


class DeviceStartOut(BaseModel):
    device_code: str
    user_code: str
    verification_url: str
    expires_in: int = 900
    interval: int = 3


class DeviceApprove(BaseModel):
    user_code: str


class DevicePoll(BaseModel):
    device_code: str


class DevicePollOut(BaseModel):
    status: str
    token: str | None = None


# ---- helpers ---------------------------------------------------------------------


def _base_url(request: Request) -> str:
    if settings.public_url:
        return settings.public_url.rstrip("/")
    return str(request.base_url).rstrip("/")


def _set_cookie(response: Response, raw: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        raw,
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


async def _session_out(session: SessionDep, user: User) -> SessionOut:
    org = await session.get(Org, user.org_id)
    return SessionOut(
        id=str(user.id),
        email=user.email,
        name=user.name,
        role=user.role,
        org_id=str(user.org_id),
        org_name=org.name if org else "",
    )


# ---- first run, sign in, sign out ---------------------------------------------------


@router.get("/bootstrap", response_model=BootstrapOut)
async def bootstrap_state(session: SessionDep) -> BootstrapOut:
    """Unauthenticated on purpose: the sign-in page needs to know whether to
    offer 'create your organisation' or 'sign in'."""
    fresh = await needs_setup(session)
    org = None if fresh else (await session.execute(select(Org).limit(1))).scalar_one_or_none()
    return BootstrapOut(
        needs_setup=fresh,
        org_name=org.name if org else None,
        smtp_enabled=bool(settings.smtp_host),
    )


@router.post("/signup", response_model=SessionOut)
async def signup(body: SignupRequest, request: Request, response: Response, session: SessionDep):
    """Only while the server is empty. The first person owns the organisation."""
    user = await bootstrap(
        session,
        org_name=body.org_name,
        email=body.email,
        password=body.password,
        name=body.name or None,
    )
    raw, _ = await create_session(session, user, request.headers.get("user-agent"))
    _set_cookie(response, raw)
    return await _session_out(session, user)


@router.post("/login", response_model=SessionOut)
async def sign_in(body: LoginRequest, request: Request, response: Response, session: SessionDep):
    raw, user = await login(session, body.email, body.password, request.headers.get("user-agent"))
    _set_cookie(response, raw)
    return await _session_out(session, user)


@router.post("/logout", status_code=204)
async def sign_out(request: Request, response: Response, session: SessionDep) -> Response:
    await revoke_session(session, request.cookies.get(SESSION_COOKIE))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return Response(status_code=204)


@router.get("/session", response_model=SessionOut)
async def whoami(principal: PrincipalDep, session: SessionDep) -> SessionOut:
    user = await session.get(User, principal.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue.")
    return await _session_out(session, user)


@router.post("/password", status_code=204)
async def change_password(body: PasswordRequest, principal: PrincipalDep, session: SessionDep):
    """Set or change your own password. A user who has none yet (created by
    `drymem-admin` before identity existed) may set one without a current."""
    user = await session.get(User, principal.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such user.")
    if user.password_hash and not verify_password(user.password_hash, body.current):
        raise AuthError("Your current password is not right.")
    user.password_hash = hash_password(body.new)
    return Response(status_code=204)


# ---- invites -------------------------------------------------------------------------


@router.post("/invites", response_model=InviteOut)
async def invite(
    body: InviteRequest, admin: AdminDep, request: Request, session: SessionDep
) -> InviteOut:
    project = None
    if body.project_key:
        project = await project_for(session, admin, body.project_key)
        if project is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No such project.")

    raw, row = await create_invite(
        session, inviter=admin, email=body.email, role=body.role, project=project
    )
    url = f"{_base_url(request)}/#/invite/{raw}"
    # SMTP delivery arrives with Step D's governance work; until then the admin
    # forwards the link, which is also the only thing that works on a laptop.
    return InviteOut(
        id=str(row.id),
        email=row.email,
        role=row.role,
        project_key=project.project_key if project else None,
        invited_by=admin.email,
        expires_at=row.expires_at,
        invite_url=url,
    )


@router.get("/invites", response_model=list[InviteOut])
async def pending_invites(admin: AdminDep, session: SessionDep) -> list[InviteOut]:
    rows = await session.execute(
        select(Invite, Project.project_key, User.email)
        .outerjoin(Project, Project.id == Invite.project_id)
        .outerjoin(User, User.id == Invite.invited_by)
        .where(Invite.org_id == admin.org_id, Invite.accepted_at.is_(None))
        .order_by(Invite.created_at.desc())
    )
    return [
        InviteOut(
            id=str(i.id),
            email=i.email,
            role=i.role,
            project_key=key,
            invited_by=who,
            expires_at=i.expires_at,
        )
        for i, key, who in rows.all()
    ]


@router.delete("/invites/{invite_id}", status_code=204)
async def revoke_invite(invite_id: str, admin: AdminDep, session: SessionDep) -> Response:
    row = (
        await session.execute(
            select(Invite).where(Invite.id == invite_id, Invite.org_id == admin.org_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such invite.")
    await session.delete(row)
    return Response(status_code=204)


@router.get("/invites/{token}/public", response_model=InvitePublicOut)
async def invite_public(token: str, session: SessionDep) -> InvitePublicOut:
    """What the invite page shows before the person has an account."""
    row = await find_invite(session, token)
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This invitation is no longer valid.")
    org = await session.get(Org, row.org_id)
    project = await session.get(Project, row.project_id) if row.project_id else None
    inviter = await session.get(User, row.invited_by) if row.invited_by else None
    return InvitePublicOut(
        email=row.email,
        org_name=org.name if org else "",
        project_key=project.project_key if project else None,
        invited_by=(inviter.name or inviter.email) if inviter else None,
    )


@router.post("/invites/{token}/accept", response_model=SessionOut)
async def accept(
    token: str, body: AcceptRequest, request: Request, response: Response, session: SessionDep
):
    user = await accept_invite(session, raw=token, password=body.password, name=body.name)
    raw, _ = await create_session(session, user, request.headers.get("user-agent"))
    _set_cookie(response, raw)
    return await _session_out(session, user)


# ---- your sessions and tokens -------------------------------------------------------------


@router.get("/sessions", response_model=list[WebSessionOut])
async def my_sessions(
    principal: PrincipalDep, request: Request, session: SessionDep
) -> list[WebSessionOut]:
    from drymem_server.auth import hash_token

    current = request.cookies.get(SESSION_COOKIE)
    current_hash = hash_token(current) if current else None
    rows = await session.execute(
        select(WebSession)
        .where(WebSession.user_id == principal.user_id, WebSession.revoked_at.is_(None))
        .order_by(WebSession.created_at.desc())
    )
    return [
        WebSessionOut(
            id=str(w.id),
            user_agent=w.user_agent,
            created_at=w.created_at,
            last_seen_at=w.last_seen_at,
            current=w.token_hash == current_hash,
        )
        for w in rows.scalars()
    ]


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_my_session(session_id: str, principal: PrincipalDep, session: SessionDep):
    row = (
        await session.execute(
            select(WebSession).where(
                WebSession.id == session_id, WebSession.user_id == principal.user_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such session.")
    from datetime import UTC

    row.revoked_at = datetime.now(UTC)
    return Response(status_code=204)


@router.get("/tokens", response_model=list[TokenOut])
async def my_tokens(principal: PrincipalDep, session: SessionDep) -> list[TokenOut]:
    rows = await session.execute(
        select(ApiToken)
        .where(ApiToken.user_id == principal.user_id, ApiToken.revoked_at.is_(None))
        .order_by(ApiToken.created_at.desc())
    )
    return [
        TokenOut(id=str(t.id), label=t.label, created_at=t.created_at, last_used_at=t.last_used_at)
        for t in rows.scalars()
    ]


@router.post("/tokens", response_model=TokenOut)
async def new_token(body: TokenRequest, principal: PrincipalDep, session: SessionDep) -> TokenOut:
    """For CI and other machines. Shown once; `drymem login` is the human path."""
    user = await session.get(User, principal.user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such user.")
    raw, row = await create_token(session, user, label=body.label or None)
    return TokenOut(
        id=str(row.id), label=row.label, created_at=row.created_at, last_used_at=None, token=raw
    )


@router.delete("/tokens/{token_id}", status_code=204)
async def revoke_token(token_id: str, principal: PrincipalDep, session: SessionDep):
    row = (
        await session.execute(
            select(ApiToken).where(ApiToken.id == token_id, ApiToken.user_id == principal.user_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such token.")
    from datetime import UTC

    row.revoked_at = datetime.now(UTC)
    return Response(status_code=204)


# ---- device login ---------------------------------------------------------------------------


@router.post("/device", response_model=DeviceStartOut)
async def device_start(body: DeviceStart, request: Request, session: SessionDep) -> DeviceStartOut:
    """Step one of `drymem login`. Unauthenticated: the CLI has nothing yet."""
    label = body.label or f"drymem login @ {socket.gethostname()}"
    raw, code = await start_device_login(session, label)
    return DeviceStartOut(
        device_code=raw,
        user_code=code.user_code,
        verification_url=f"{_base_url(request)}/#/device/{code.user_code}",
    )


@router.post("/device/approve", status_code=204)
async def device_approve(body: DeviceApprove, principal: PrincipalDep, session: SessionDep):
    """Step two, in the browser, signed in."""
    await approve_device_login(session, principal=principal, user_code=body.user_code)
    return Response(status_code=204)


@router.post("/device/token", response_model=DevicePollOut)
async def device_poll(body: DevicePoll, session: SessionDep) -> DevicePollOut:
    """Step three: the CLI collects its token. Handed over exactly once."""
    status_, token = await poll_device_login(session, body.device_code)
    return DevicePollOut(status=status_, token=token)
