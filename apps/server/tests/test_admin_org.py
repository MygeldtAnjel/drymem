"""
Provisioning an organisation.

`POST /auth/signup` refuses once the server has one, deliberately — drymem is
invitation-only after the first account. That left a hosted deployment with no
way to onboard a second customer at all, which is what this command is for.

The owner is created without a password on purpose: an operator provisioning an
account should never choose, see or transmit one. They set it themselves through
the existing reset flow.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from drymem_server.admin import org_create
from drymem_server.db.models import ORG_OWNER, Org, User


@pytest.fixture(autouse=True)
def _point_admin_at_the_scratch_db(db_url, monkeypatch):
    """The command opens its own session from settings, like it does in
    production — so the setting is what has to be redirected."""
    from drymem_server.settings import settings

    monkeypatch.setattr(settings, "database_url", db_url)


@pytest.mark.asyncio
async def test_it_creates_the_organisation_and_its_owner(sessionmaker, capsys):
    assert await org_create("Beta", "owner@beta.test", "Beta Owner") == 0

    async with sessionmaker() as session:
        org = (await session.execute(select(Org).where(Org.slug == "beta"))).scalar_one()
        owner = (
            await session.execute(select(User).where(User.email == "owner@beta.test"))
        ).scalar_one()

    assert owner.org_id == org.id
    assert owner.role == ORG_OWNER
    assert owner.name == "Beta Owner"
    # The point of the whole design: no password travelled through an operator.
    assert owner.password_hash is None


@pytest.mark.asyncio
async def test_running_it_twice_does_not_make_a_second_organisation(sessionmaker):
    assert await org_create("Beta", "owner@beta.test", None) == 0
    assert await org_create("Beta", "owner@beta.test", None) == 0

    async with sessionmaker() as session:
        orgs = (await session.execute(select(Org).where(Org.slug == "beta"))).scalars().all()
        owners = (
            (await session.execute(select(User).where(User.email == "owner@beta.test")))
            .scalars()
            .all()
        )
    assert len(orgs) == 1
    assert len(owners) == 1


@pytest.mark.asyncio
async def test_it_refuses_to_move_somebody_between_organisations(sessionmaker, capsys):
    """An address already in another tenant is a mistake, not an instruction."""
    assert await org_create("Beta", "shared@example.test", None) == 0
    assert await org_create("Gamma", "shared@example.test", None) == 1

    async with sessionmaker() as session:
        owner = (
            await session.execute(select(User).where(User.email == "shared@example.test"))
        ).scalar_one()
        beta = (await session.execute(select(Org).where(Org.slug == "beta"))).scalar_one()
    assert owner.org_id == beta.id


@pytest.mark.asyncio
async def test_the_address_is_stored_lowercase(sessionmaker):
    """Login looks it up case-insensitively; storing it raw invites a duplicate."""
    assert await org_create("Delta", "Owner@Delta.Test", None) == 0
    async with sessionmaker() as session:
        found = (
            await session.execute(select(User).where(User.email == "owner@delta.test"))
        ).scalar_one_or_none()
    assert found is not None
