"""
Who the caller is, and what they may reach.

Identity lives in the control plane (`apps/api`): passwords, sessions, tokens,
invitations and the device flow are all there, and this service never sees a
credential. What is left here is the half that is about *memory* — which
project a principal may read, and with what role — because those questions are
answered by joining tables this service already queries for every search.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from drymem_server.db.models import (
    ORG_ADMIN,
    ORG_MEMBER,
    ORG_OWNER,
    ROLE_LEAD,
    Project,
    ProjectMember,
)


@dataclass(frozen=True)
class Principal:
    """Who is making this request, as asserted by the control plane."""

    user_id: object
    org_id: object
    email: str
    role: str = ORG_MEMBER

    @property
    def is_admin(self) -> bool:
        return self.role in (ORG_OWNER, ORG_ADMIN)


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
