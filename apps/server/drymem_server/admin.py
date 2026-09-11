"""
drymem-admin — server-side account management.

Runs where the database is, not on a developer's laptop. Until there is a
dashboard (step 6) this is how a person gets a token.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import select

from drymem_server.auth import create_token
from drymem_server.db.models import ApiToken, Memory, Org, Project, ProjectMember, User
from drymem_server.db.session import sessionmaker_for
from drymem_server.settings import settings


def _slug(name: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in name.lower()).strip("-")


async def _org(session, name: str) -> Org:
    slug = _slug(name)
    found = (await session.execute(select(Org).where(Org.slug == slug))).scalar_one_or_none()
    if found:
        return found
    org = Org(name=name, slug=slug)
    session.add(org)
    await session.flush()
    return org


async def user_create(email: str, org_name: str, name: str | None) -> int:
    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        org = await _org(session, org_name)
        existing = (
            await session.execute(select(User).where(User.email == email, User.org_id == org.id))
        ).scalar_one_or_none()
        if existing:
            print(f"User already exists: {email} in {org.name}", file=sys.stderr)
            return 1
        session.add(User(org_id=org.id, email=email, name=name))
        await session.commit()
    print(f"Created {email} in org {org_name}")
    return 0


async def token_create(email: str, label: str | None) -> int:
    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            print(f"No such user: {email}. Create it first.", file=sys.stderr)
            return 1
        raw, _ = await create_token(session, user, label=label)
        await session.commit()

    # Shown once. Only the SHA-256 is stored, so it cannot be recovered later.
    print(raw)
    print("\nThis token is shown once. Store it now.", file=sys.stderr)
    return 0


async def token_revoke(label: str) -> int:
    from datetime import UTC, datetime

    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        tokens = (
            (
                await session.execute(
                    select(ApiToken).where(ApiToken.label == label, ApiToken.revoked_at.is_(None))
                )
            )
            .scalars()
            .all()
        )
        if not tokens:
            print(f"No active token labelled {label!r}", file=sys.stderr)
            return 1
        for token in tokens:
            token.revoked_at = datetime.now(UTC)
        await session.commit()
    print(f"Revoked {len(tokens)} token(s) labelled {label!r}")
    return 0


async def backfill(project_key: str, email: str) -> int:
    """Create index rows for episodes that only exist in the graph.

    Memories saved before Postgres existed (or migrated from an older group id)
    have no row, so they are searchable but invisible to anything that counts,
    lists or rates them. The TUI made that gap obvious: the dashboard said 3
    memories while the list showed 6.

    Idempotent: `memories.episode_uuid` is unique, so a second run adds nothing.
    """
    from drymem_server.identity import sanitize_group_id
    from drymem_server.memory_store import GraphitiMemoryStore

    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            print(f"No such user: {email}", file=sys.stderr)
            return 1

        project = (
            await session.execute(
                select(Project).where(
                    Project.project_key == project_key, Project.org_id == user.org_id
                )
            )
        ).scalar_one_or_none()
        if project is None:
            project = Project(org_id=user.org_id, project_key=project_key)
            session.add(project)
            await session.flush()
            session.add(ProjectMember(project_id=project.id, user_id=user.id))
            await session.flush()

        episodes = await GraphitiMemoryStore().recent(
            group_ids=[sanitize_group_id(project_key)], limit=1000
        )
        known = set(
            (
                await session.execute(
                    select(Memory.episode_uuid).where(Memory.project_id == project.id)
                )
            ).scalars()
        )

        added = 0
        for episode in episodes:
            if episode.uuid in known:
                continue
            title = next(
                (
                    line.strip().lstrip("#").strip()
                    for line in (episode.content or "").splitlines()
                    if line.strip()
                ),
                episode.name,
            )
            session.add(
                Memory(
                    org_id=user.org_id,
                    project_id=project.id,
                    author_id=user.id,
                    episode_uuid=episode.uuid,
                    topic_key=episode.name or None,
                    title=title[:500],
                    tool=episode.metadata.tool if episode.metadata else "claude-code",
                    scope="private",
                    created_at=episode.created_at,
                )
            )
            added += 1
        await session.commit()

    print(f"Indexed {added} episode(s) for {project_key} ({len(episodes)} in the graph)")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="drymem-admin", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("user-create", help="Add a user to an org")
    p.add_argument("email")
    p.add_argument("--org", required=True)
    p.add_argument("--name")

    p = sub.add_parser("token-create", help="Issue an API token (shown once)")
    p.add_argument("email")
    p.add_argument("--label")

    p = sub.add_parser("token-revoke", help="Revoke every active token with this label")
    p.add_argument("label")

    p = sub.add_parser("backfill", help="Index graph episodes that have no database row")
    p.add_argument("project_key")
    p.add_argument("--as", dest="email", required=True, help="Attribute them to this user")

    args = parser.parse_args(argv)
    if args.command == "user-create":
        return asyncio.run(user_create(args.email, args.org, args.name))
    if args.command == "token-create":
        return asyncio.run(token_create(args.email, args.label))
    if args.command == "backfill":
        return asyncio.run(backfill(args.project_key, args.email))
    return asyncio.run(token_revoke(args.label))


if __name__ == "__main__":
    raise SystemExit(main())
