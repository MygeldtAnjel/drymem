"""
Identity, end to end over HTTP.

The web client is a cookie; the CLI is a bearer. Both must reach the same
principal, and everything that changes shared state must refuse the wrong role
in the *service*, not merely hide a button.
"""

from __future__ import annotations

import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from drymem_server.api.app import create_app
from drymem_server.api.deps import get_session
from drymem_server.db.models import User
from tests.conftest import auth

WEB = {"X-Drymem-Client": "web"}
PROJECT = "github.com/acme/payments"


@pytest.fixture
async def fresh(sessionmaker, store):
    """A server with nobody on it — the state a first visitor finds."""
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
        yield ac


async def signup(client, email="owner@acme.test", password="correct horse battery"):
    return await client.post(
        "/auth/signup",
        headers=WEB,
        json={"org_name": "Acme", "email": email, "password": password, "name": "Owner"},
    )


# ---- first run ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_fresh_server_asks_to_be_set_up(fresh):
    body = (await fresh.get("/auth/bootstrap")).json()
    assert body["needs_setup"] is True


@pytest.mark.asyncio
async def test_the_first_person_owns_the_org_and_is_signed_in(fresh):
    response = await signup(fresh)
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "owner"
    assert "drymem_session" in response.cookies

    me = await fresh.get("/auth/session")
    assert me.status_code == 200
    assert me.json()["email"] == "owner@acme.test"


@pytest.mark.asyncio
async def test_signup_is_refused_once_anyone_exists(fresh):
    """Otherwise a server left open on a network hands ownership to the next visitor."""
    await signup(fresh)
    second = await signup(fresh, email="stranger@evil.test")
    assert second.status_code == 400
    assert "invite" in second.json()["detail"].lower()
    assert (await fresh.get("/auth/bootstrap")).json()["needs_setup"] is False


@pytest.mark.asyncio
async def test_short_passwords_are_refused(fresh):
    response = await signup(fresh, password="short")
    assert response.status_code == 400


# ---- sign in and out ------------------------------------------------------------------


@pytest.mark.asyncio
async def test_login_logout(fresh):
    await signup(fresh)
    await fresh.post("/auth/logout", headers=WEB)
    assert (await fresh.get("/auth/session")).status_code == 401

    bad = await fresh.post(
        "/auth/login", headers=WEB, json={"email": "owner@acme.test", "password": "wrong"}
    )
    assert bad.status_code == 400
    assert bad.json()["detail"] == "That email and password do not match."

    good = await fresh.post(
        "/auth/login",
        headers=WEB,
        json={"email": "OWNER@acme.test", "password": "correct horse battery"},
    )
    assert good.status_code == 200
    assert (await fresh.get("/auth/session")).status_code == 200


@pytest.mark.asyncio
async def test_a_cookie_without_the_client_header_cannot_write(fresh):
    """SameSite=Lax plus a custom header is what stops a cross-site form post."""
    await signup(fresh)
    response = await fresh.patch("/v1/me", json={"name": "Hijacked"})
    assert response.status_code == 403
    ok = await fresh.patch("/v1/me", headers=WEB, json={"name": "Owner B"})
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_a_revoked_session_stops_working(fresh):
    await signup(fresh)
    sessions = (await fresh.get("/auth/sessions")).json()
    assert len(sessions) == 1 and sessions[0]["current"] is True
    await fresh.delete(f"/auth/sessions/{sessions[0]['id']}", headers=WEB)
    assert (await fresh.get("/auth/session")).status_code == 401


# ---- invites ----------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_invite_accept_joins_the_org_and_the_project(fresh):
    await signup(fresh)
    # The owner creates a project by saving into it.
    saved = await fresh.post(
        "/v1/memories",
        headers=WEB,
        json={"project_key": PROJECT, "summary": "first", "topic_key": "a"},
    )
    assert saved.status_code == 200, saved.text

    invited = await fresh.post(
        "/auth/invites",
        headers=WEB,
        json={"email": "Jose@acme.test", "role": "member", "project_key": PROJECT},
    )
    assert invited.status_code == 200, invited.text
    url = invited.json()["invite_url"]
    assert "/#/invite/" in url
    token = url.rsplit("/", 1)[1]

    # A second browser, nobody signed in.
    async with AsyncClient(transport=fresh._transport, base_url="http://test") as other:
        public = await other.get(f"/auth/invites/{token}/public")
        assert public.status_code == 200
        assert public.json()["email"] == "jose@acme.test"
        assert public.json()["project_key"] == PROJECT

        accepted = await other.post(
            f"/auth/invites/{token}/accept",
            headers=WEB,
            json={"password": "another long password", "name": "Jose"},
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["role"] == "member"

        # They can read the project now, and a second use of the link fails.
        members = await other.get(f"/v1/projects/{PROJECT}/members")
        assert members.status_code == 200
        assert {m["email"] for m in members.json()["members"]} == {
            "owner@acme.test",
            "jose@acme.test",
        }
        again = await other.post(
            f"/auth/invites/{token}/accept", headers=WEB, json={"password": "another long one"}
        )
        assert again.status_code == 400


@pytest.mark.asyncio
async def test_only_an_admin_can_invite(client):
    """`client` is the two-org world with bearer tokens; jose is a plain member."""
    response = await client.post(
        "/auth/invites", headers=auth(client, "jose"), json={"email": "x@acme.test"}
    )
    assert response.status_code == 403


# ---- roles in the service ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_member_cannot_rename_the_project_or_manage_members(client, sessionmaker):
    """Hidden buttons are not permissions (D31)."""
    await client.post(
        "/v1/memories",
        headers=auth(client, "miguel"),
        json={"project_key": PROJECT, "summary": "x", "topic_key": "a"},
    )
    await client.post(
        f"/v1/projects/{PROJECT}/members",
        headers=auth(client, "miguel"),
        json={"email": "jose@acme.test"},
    )

    renamed = await client.patch(
        f"/v1/projects/{PROJECT}", headers=auth(client, "jose"), json={"display_name": "Mine"}
    )
    assert renamed.status_code == 403

    removed = await client.delete(
        f"/v1/projects/{PROJECT}/members/miguel@acme.test", headers=auth(client, "jose")
    )
    assert removed.status_code == 403

    # The lead who created the project still can.
    ok = await client.patch(
        f"/v1/projects/{PROJECT}", headers=auth(client, "miguel"), json={"display_name": "Pay"}
    )
    assert ok.status_code == 200


@pytest.mark.asyncio
async def test_the_project_creator_is_its_lead(client, sessionmaker):
    await client.post(
        "/v1/memories",
        headers=auth(client, "miguel"),
        json={"project_key": PROJECT, "summary": "x", "topic_key": "a"},
    )
    members = (
        await client.get(f"/v1/projects/{PROJECT}/members", headers=auth(client, "miguel"))
    ).json()["members"]
    assert members == [
        {"user_id": members[0]["user_id"], "email": "miguel@acme.test", "role": "lead"}
    ]


# ---- device login -------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_device_login_hands_the_cli_a_token_once(fresh):
    await signup(fresh)

    # The CLI, unauthenticated, asks for a code.
    async with AsyncClient(transport=fresh._transport, base_url="http://test") as cli:
        started = (await cli.post("/auth/device", json={"label": "laptop"})).json()
        assert "/#/device/" in started["verification_url"]
        pending = (
            await cli.post("/auth/device/token", json={"device_code": started["device_code"]})
        ).json()
        assert pending == {"status": "pending", "token": None}

        # The browser, signed in, approves the short code.
        approved = await fresh.post(
            "/auth/device/approve", headers=WEB, json={"user_code": started["user_code"].lower()}
        )
        assert approved.status_code == 204, approved.text

        # The CLI collects it, and it works as a bearer.
        got = (
            await cli.post("/auth/device/token", json={"device_code": started["device_code"]})
        ).json()
        assert got["status"] == "approved" and got["token"].startswith("drymem_")
        me = await cli.get("/v1/me", headers={"Authorization": f"Bearer {got['token']}"})
        assert me.status_code == 200

        # Exactly once.
        second = (
            await cli.post("/auth/device/token", json={"device_code": started["device_code"]})
        ).json()
        assert second["token"] is None


# ---- users made before identity existed ----------------------------------------------------


@pytest.mark.asyncio
async def test_a_pre_identity_user_can_set_a_first_password(client, sessionmaker):
    """`drymem-admin user-create` rows have no password. They set one without a current."""
    response = await client.post(
        "/auth/password", headers=auth(client, "miguel"), json={"new": "a first real password"}
    )
    assert response.status_code == 204

    async with sessionmaker() as session:
        user = (
            await session.execute(select(User).where(User.email == "miguel@acme.test"))
        ).scalar_one()
        assert user.password_hash is not None
        assert uuid.UUID(str(user.id))


@pytest.mark.asyncio
async def test_an_invite_for_the_owners_own_email_sets_a_password_without_demoting(
    fresh, sessionmaker
):
    """The break-glass path for accounts that predate identity."""
    from drymem_server.auth import Principal, create_invite
    from drymem_server.db.models import Org

    await signup(fresh)
    async with sessionmaker() as session:
        owner = (
            await session.execute(select(User).where(User.email == "owner@acme.test"))
        ).scalar_one()
        owner.password_hash = None  # as if created by drymem-admin, long ago
        org = await session.get(Org, owner.org_id)
        raw, _ = await create_invite(
            session,
            inviter=Principal(user_id=owner.id, org_id=org.id, email=owner.email, role="owner"),
            email=owner.email,
            role="admin",
            project=None,
        )
        await session.commit()

    async with AsyncClient(transport=fresh._transport, base_url="http://test") as other:
        accepted = await other.post(
            f"/auth/invites/{raw}/accept", headers=WEB, json={"password": "a brand new password"}
        )
        assert accepted.status_code == 200, accepted.text
        assert accepted.json()["role"] == "owner"

    async with sessionmaker() as session:
        users = (await session.execute(select(User))).scalars().all()
        assert len(users) == 1  # claimed, not duplicated
