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


async def migrate_scopes(project_key: str) -> int:
    """Move pre-3A memories out of the unscoped group into their author's.

    Each episode's author is in Postgres, so this moves them precisely rather
    than guessing. Until it runs, a project with more than one member simply
    stops reading the unscoped group (see `MemoryService.readable_groups`) — the
    memories are not lost, just not shown, which is the safe failure.

    Idempotent, and an episode with no index row is reported rather than moved:
    without a row there is nothing that says whose it is.
    """
    import os

    from neo4j import AsyncGraphDatabase

    from drymem_server.identity import group_id_private, sanitize_group_id

    legacy = sanitize_group_id(project_key)
    factory = sessionmaker_for(settings.database_url)

    async with factory() as session:
        project = (
            await session.execute(select(Project).where(Project.project_key == project_key))
        ).scalar_one_or_none()
        if project is None:
            print(f"No such project: {project_key}", file=sys.stderr)
            return 1

        rows = (
            await session.execute(
                select(Memory.episode_uuid, Memory.author_id).where(Memory.project_id == project.id)
            )
        ).all()
        owner = {uuid: author for uuid, author in rows}

    driver = AsyncGraphDatabase.driver(
        os.getenv("NEO4J_URI", settings.neo4j_uri),
        auth=(settings.neo4j_user, settings.neo4j_password),
    )
    moved = orphaned = 0
    try:
        async with driver.session() as neo:
            result = await neo.run(
                "MATCH (e:Episodic) WHERE e.group_id = $g RETURN e.uuid AS uuid", g=legacy
            )
            uuids = [record["uuid"] async for record in result]

            for uuid in uuids:
                author = owner.get(uuid)
                if author is None:
                    orphaned += 1
                    continue
                target = group_id_private(project_key, author)
                await neo.run(
                    "MATCH (n) WHERE n.group_id = $old AND n.uuid = $uuid SET n.group_id = $new",
                    old=legacy,
                    uuid=uuid,
                    new=target,
                )
                moved += 1

            # Entities and relationships in the legacy group belong to whoever
            # owns the episodes there. With one author they move wholesale; with
            # several they are left alone rather than guessed at.
            authors = {owner[u] for u in uuids if u in owner}
            if len(authors) == 1:
                target = group_id_private(project_key, next(iter(authors)))
                await neo.run(
                    "MATCH (n) WHERE n.group_id = $old SET n.group_id = $new",
                    old=legacy,
                    new=target,
                )
                await neo.run(
                    "MATCH ()-[r]->() WHERE r.group_id = $old SET r.group_id = $new",
                    old=legacy,
                    new=target,
                )
    finally:
        await driver.close()

    print(f"Moved {moved} episode(s) out of {legacy}")
    if orphaned:
        print(f"  {orphaned} left in place — no index row, so no known author.", file=sys.stderr)
        print("  Run `drymem-admin backfill` first to give them one.", file=sys.stderr)
    return 0


async def stats(days: int) -> int:
    """The numbers the pilot is judged on.

    PLAN.md sets the bar at 90% useful on retrievals. That number has to come
    from somewhere, and until there is a dashboard (step 6) this is where.
    """
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import case, func

    from drymem_server.db.models import AuditLog, Memory, MemoryFeedback, ProjectMember

    # Computed here rather than as a SQL interval: asyncpg will not encode a
    # string into an INTERVAL parameter, and a datetime is portable anyway.
    cutoff = datetime.now(UTC) - timedelta(days=days)

    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        totals = (
            await session.execute(
                select(
                    func.count(Memory.id),
                    func.count(case((Memory.scope == "team", Memory.id))),
                    func.count(func.distinct(Memory.author_id)),
                )
            )
        ).one()

        feedback = (
            await session.execute(
                select(
                    func.count(case((MemoryFeedback.rating > 0, MemoryFeedback.id))),
                    func.count(case((MemoryFeedback.rating < 0, MemoryFeedback.id))),
                )
            )
        ).one()

        per_project = (
            await session.execute(
                select(Project.project_key, func.count(Memory.id))
                .outerjoin(Memory, Memory.project_id == Project.id)
                .group_by(Project.project_key)
                .order_by(func.count(Memory.id).desc())
            )
        ).all()

        recent = (
            await session.execute(
                select(func.date(Memory.created_at), func.count(Memory.id))
                .where(Memory.created_at >= cutoff)
                .group_by(func.date(Memory.created_at))
                .order_by(func.date(Memory.created_at).desc())
            )
        ).all()

        members = (await session.execute(select(func.count(ProjectMember.id)))).scalar() or 0
        promotions = (
            await session.execute(
                select(func.count(AuditLog.id)).where(AuditLog.action == "memory.promote")
            )
        ).scalar() or 0

    total, team, authors = totals
    up, down = feedback
    rated = up + down

    print(f"memories      {total}  ({team} shared, {total - team} private)")
    print(f"authors       {authors}")
    print(f"memberships   {members}")
    print(f"promotions    {promotions}")
    if rated:
        print(f"useful        {round(up / rated * 100)}%  ({up} up, {down} down, {rated} rated)")
    else:
        print("useful        no ratings yet — the 90% bar needs these")

    print("\nper project")
    for key, count in per_project:
        print(f"  {count:5}  {key}")

    print(f"\nsaves, last {days} days")
    if not recent:
        print("  none")
    for day, count in recent:
        print(f"  {day}  {'█' * min(count, 40)} {count}")
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

    p = sub.add_parser("migrate-scopes", help="Move pre-3A memories into their author's group")
    p.add_argument("project_key")

    p = sub.add_parser("stats", help="The numbers the pilot is judged on")
    p.add_argument("--days", type=int, default=14)

    args = parser.parse_args(argv)
    if args.command == "user-create":
        return asyncio.run(user_create(args.email, args.org, args.name))
    if args.command == "token-create":
        return asyncio.run(token_create(args.email, args.label))
    if args.command == "backfill":
        return asyncio.run(backfill(args.project_key, args.email))
    if args.command == "migrate-scopes":
        return asyncio.run(migrate_scopes(args.project_key))
    if args.command == "stats":
        return asyncio.run(stats(args.days))
    return asyncio.run(token_revoke(args.label))


if __name__ == "__main__":
    raise SystemExit(main())
