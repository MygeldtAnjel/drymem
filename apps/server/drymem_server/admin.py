"""
drymem-admin — repair and migration, where the database is.

Accounts, tokens and invitations are the control plane's job now: people sign
up, get invited, and run `drymem login` in a browser. What is left here is the
work that spans *both* stores — renaming a person across Postgres and the graph,
indexing episodes that have no row — plus the numbers the pilot is judged on.
None of it belongs in a web request.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from sqlalchemy import func, select

from drymem_server.db.models import Memory, Org, Project, ProjectMember, User
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
        org_id = project.org_id

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
                target = group_id_private(org_id, project_key, author)
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
                target = group_id_private(org_id, project_key, next(iter(authors)))
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


async def user_rename(old: str, new: str) -> int:
    """Change a user's email everywhere it is recorded.

    Two stores hold it. Postgres holds the row, and Neo4j holds a copy inside
    every episode's `source_description` because that metadata has to survive a
    database that is not there. Changing one and not the other would leave a
    person's own memories attributed to an address that no longer exists.

    Tokens survive: they are keyed on the user's id, not their email.
    """
    from drymem_server.graph import get_graphiti

    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        user = (await session.execute(select(User).where(User.email == old))).scalar_one_or_none()
        if user is None:
            print(f"No user with email {old!r}.", file=sys.stderr)
            return 1

        clash = (
            await session.execute(select(User).where(User.email == new, User.org_id == user.org_id))
        ).scalar_one_or_none()
        if clash is not None:
            print(f"{new!r} is already taken in this org.", file=sys.stderr)
            return 1

        user.email = new
        await session.commit()

    graphiti = await get_graphiti()
    updated = await graphiti.driver.execute_query(
        """
        MATCH (e:Episodic)
        WHERE e.source_description CONTAINS $old
        SET e.source_description = replace(e.source_description, $old, $new)
        RETURN count(e) AS n
        """,
        old=old,
        new=new,
    )
    episodes = _row_count(updated)

    print(f"Renamed {old} -> {new}")
    print(f"  episodes re-attributed: {episodes}")
    print("  tokens still work: they are keyed on the user id, not the email.")
    return 0


def _row_count(result: object) -> int:
    """Graphiti returns the driver's own result shape, which differs by version."""
    records = result[0] if isinstance(result, tuple) else result
    for record in records or []:
        try:
            return int(record["n"])
        except (KeyError, TypeError, ValueError):
            return 0
    return 0


async def user_delete(email: str) -> int:
    """Remove a user, their tokens, their memberships and their index rows.

    Their episodes stay in the graph — deleting them would need every uuid, and
    an orphaned episode in a group nobody reads is far safer than a half-finished
    delete. `migrate-scopes` and `backfill` can both be re-run afterwards.
    """
    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if user is None:
            print(f"No user with email {email!r}.", file=sys.stderr)
            return 1

        memories = (
            await session.execute(select(func.count(Memory.id)).where(Memory.author_id == user.id))
        ).scalar() or 0
        await session.delete(user)
        await session.commit()

    print(f"Deleted {email}")
    print(f"  index rows removed: {memories}")
    if memories:
        print("  their episodes remain in the graph, in a group nobody now reads.")
    return 0


async def org_create(name: str, owner_email: str, owner_name: str | None) -> int:
    """Put a second organisation on this server.

    There was no way to. `POST /auth/signup` refuses once the server has an
    organisation — deliberately, because drymem is invitation-only after the
    first account — and nothing else created one. A self-hosted install has
    exactly one company on it and that is correct; a hosted one could not
    onboard a second customer at all.

    The owner is created **without a password**, which the schema already allows,
    and sets their own through the existing forgot-password flow. An operator
    provisioning an account should never choose, see or transmit a password.

    Idempotent on the slug: running it twice does not make a second Acme.
    """
    from drymem_server.db.models import ORG_OWNER

    email = owner_email.strip().lower()
    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        org = await _org(session, name)

        existing = (
            await session.execute(select(User).where(User.email == email))
        ).scalar_one_or_none()
        if existing is not None:
            if existing.org_id != org.id:
                print(
                    f"{email} already belongs to another organisation.",
                    file=sys.stderr,
                )
                return 1
            print(f"{name} already exists, owned by {email}.")
            return 0

        session.add(
            User(
                org_id=org.id,
                email=email,
                name=(owner_name or "").strip() or None,
                role=ORG_OWNER,
                password_hash=None,
            )
        )
        await session.commit()

    print(f"Created {name!r} with owner {email}.")
    print("They set their password with 'Forgot password' on the sign-in page.")
    return 0


async def migrate_orgs() -> int:
    """Move every memory into a group id that includes its organisation.

    Group ids used to be built from the project key alone, and a project key is
    a git remote — so two organisations that both tracked
    `github.com/acme/payments` shared one Neo4j group, and a member of either
    read the other's shared memories. Adding the org to the id closes that, and
    orphans everything already stored until this has run.

    Idempotent: an episode already in its new group is left alone.

    **A group holding more than one organisation's episodes is the leak having
    already happened.** Its episodes are moved individually, by the org each one
    belongs to, and its entities and relationships are left where they are —
    they cannot be attributed to a tenant after the fact, and guessing would
    move one org's extracted facts into another's.
    """
    import os

    from neo4j import AsyncGraphDatabase

    from drymem_server.identity import group_id_private, group_id_team

    factory = sessionmaker_for(settings.database_url)
    async with factory() as session:
        rows = (
            await session.execute(
                select(
                    Memory.episode_uuid,
                    Memory.team_episode_uuid,
                    Memory.author_id,
                    Project.project_key,
                    Project.org_id,
                ).join(Project, Project.id == Memory.project_id)
            )
        ).all()

    if not rows:
        print("No memories to move.")
        return 0

    # Three maps, built in one pass: where each episode should live, where each
    # old group should become, and which organisations were found in each old
    # group — the last one is what says whether the group can be moved whole.
    target: dict[str, str] = {}
    moves: dict[str, str] = {}
    tenants: dict[str, set] = {}
    for private_uuid, team_uuid, author_id, project_key, org_id in rows:
        pairs = []
        if private_uuid:
            pairs.append(
                (
                    private_uuid,
                    _legacy_private(project_key, author_id),
                    group_id_private(org_id, project_key, author_id),
                )
            )
        if team_uuid:
            pairs.append(
                (team_uuid, _legacy_team(project_key), group_id_team(org_id, project_key))
            )
        for uuid, old_group, new_group in pairs:
            target[uuid] = new_group
            moves[old_group] = new_group
            tenants.setdefault(old_group, set()).add(org_id)

    shared = {group for group, orgs in tenants.items() if len(orgs) > 1}

    driver = AsyncGraphDatabase.driver(
        os.getenv("NEO4J_URI", settings.neo4j_uri),
        auth=(settings.neo4j_user, settings.neo4j_password),
    )
    moved = already = missing = 0
    try:
        async with driver.session() as neo:
            for uuid, new in target.items():
                result = await neo.run(
                    "MATCH (e:Episodic) WHERE e.uuid = $uuid RETURN e.group_id AS g", uuid=uuid
                )
                record = await result.single()
                if record is None:
                    missing += 1
                    continue
                if record["g"] == new:
                    already += 1
                    continue
                await neo.run(
                    "MATCH (e:Episodic) WHERE e.uuid = $uuid SET e.group_id = $new",
                    uuid=uuid,
                    new=new,
                )
                moved += 1

            # Entities and edges follow their group wholesale, but only where
            # that group belonged to exactly one organisation.
            for old, new in moves.items():
                if old in shared or old == new:
                    continue
                await neo.run(
                    "MATCH (n) WHERE n.group_id = $old AND NOT n:Episodic SET n.group_id = $new",
                    old=old,
                    new=new,
                )
                await neo.run(
                    "MATCH ()-[r]->() WHERE r.group_id = $old SET r.group_id = $new",
                    old=old,
                    new=new,
                )
    finally:
        await driver.close()

    print(f"Moved {moved} episode(s); {already} already in place.")
    if missing:
        print(f"  {missing} index row(s) point at an episode the graph does not have.")
    if shared:
        print(
            f"  {len(shared)} group(s) held more than one organisation — "
            "their episodes moved, their entities did not:",
            file=sys.stderr,
        )
        for group in sorted(shared):
            print(f"    {group}", file=sys.stderr)
    return 0


def _legacy_team(project_key: str) -> str:
    """The team group id as it was built before organisations were in it."""
    from drymem_server.identity import sanitize_group_id

    return sanitize_group_id(f"{project_key}/team")


def _legacy_private(project_key: str, user_id) -> str:
    from drymem_server.identity import sanitize_group_id

    return sanitize_group_id(f"{project_key}/u/{str(user_id).replace('-', '')[:8]}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="drymem-admin", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("org-create", help="Add an organisation and its owner")
    p.add_argument("name", help="The organisation's display name")
    p.add_argument("--owner", required=True, help="Email of the person who will own it")
    p.add_argument("--owner-name", default=None, help="Their display name, optional")

    p = sub.add_parser("user-rename", help="Change a user's email, in both stores")
    p.add_argument("old")
    p.add_argument("new")

    p = sub.add_parser("user-delete", help="Remove a user, their tokens and their index rows")
    p.add_argument("email")

    p = sub.add_parser("backfill", help="Index graph episodes that have no database row")
    p.add_argument("project_key")
    p.add_argument("--as", dest="email", required=True, help="Attribute them to this user")

    p = sub.add_parser("migrate-scopes", help="Move pre-3A memories into their author's group")
    p.add_argument("project_key")

    sub.add_parser(
        "migrate-orgs",
        help="Move memories into organisation-scoped groups (run once, after upgrading)",
    )

    p = sub.add_parser("stats", help="The numbers the pilot is judged on")
    p.add_argument("--days", type=int, default=14)

    args = parser.parse_args(argv)
    if args.command == "org-create":
        return asyncio.run(org_create(args.name, args.owner, args.owner_name))
    if args.command == "user-rename":
        return asyncio.run(user_rename(args.old, args.new))
    if args.command == "user-delete":
        return asyncio.run(user_delete(args.email))
    if args.command == "backfill":
        return asyncio.run(backfill(args.project_key, args.email))
    if args.command == "migrate-scopes":
        return asyncio.run(migrate_scopes(args.project_key))
    if args.command == "migrate-orgs":
        return asyncio.run(migrate_orgs())
    return asyncio.run(stats(args.days))


if __name__ == "__main__":
    raise SystemExit(main())
