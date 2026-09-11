"""
Postgres schema: everything about a memory except its content.

Neo4j holds what was learned; this holds who learned it, where, and whether it
has been shared. The split keeps "list Jose's promoted memories in this project,
newest first" a cheap indexed query instead of a graph traversal.

`org_id` is on every table from the first migration. Adding a tenant column to a
populated database later is a migration nobody enjoys; carrying it from the start
costs one column.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

# Scope of a memory. Step 2A writes only PRIVATE; step 3A introduces promotion.
SCOPE_PRIVATE = "private"
SCOPE_TEAM = "team"

ROLE_MEMBER = "member"
ROLE_ADMIN = "admin"


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now(), nullable=False
    )


class Org(Base, TimestampMixin):
    __tablename__ = "orgs"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    users: Mapped[list[User]] = relationship(back_populates="org", cascade="all, delete-orphan")
    projects: Mapped[list[Project]] = relationship(
        back_populates="org", cascade="all, delete-orphan"
    )


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("org_id", "email", name="uq_users_org_email"),)

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    name: Mapped[str | None] = mapped_column(String(200))

    org: Mapped[Org] = relationship(back_populates="users")
    tokens: Mapped[list[ApiToken]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class ApiToken(Base, TimestampMixin):
    __tablename__ = "api_tokens"

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # SHA-256 of a 32-byte random token. The plaintext is shown once and never stored.
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    label: Mapped[str | None] = mapped_column(String(200))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="tokens")

    @property
    def active(self) -> bool:
        return self.revoked_at is None


class Project(Base, TimestampMixin):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("org_id", "project_key", name="uq_projects_org_key"),)

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The normalised git remote, e.g. github.com/acme/payments.
    project_key: Mapped[str] = mapped_column(String(500), nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(200))

    org: Mapped[Org] = relationship(back_populates="projects")
    members: Mapped[list[ProjectMember]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class ProjectMember(Base, TimestampMixin):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_member_project_user"),)

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=_uuid)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, default=ROLE_MEMBER)

    project: Mapped[Project] = relationship(back_populates="members")


class Memory(Base, TimestampMixin):
    """The index. Content lives in Neo4j under `episode_uuid`."""

    __tablename__ = "memories"
    __table_args__ = (
        Index("ix_memories_project_created", "project_id", "created_at"),
        Index("ix_memories_project_scope", "project_id", "scope"),
        Index("ix_memories_topic", "project_id", "topic_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=_uuid)
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False
    )
    author_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # The Neo4j episode. Unique so a backfill can run twice safely.
    episode_uuid: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    topic_key: Mapped[str | None] = mapped_column(String(300))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    tool: Mapped[str] = mapped_column(String(50), nullable=False, default="claude-code")
    scope: Mapped[str] = mapped_column(String(20), nullable=False, default=SCOPE_PRIVATE)
    promoted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    promoted_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )

    @property
    def shared(self) -> bool:
        return self.scope == SCOPE_TEAM


class MemoryFeedback(Base, TimestampMixin):
    """Thumbs on a retrieved memory. The precision metric the pilot is judged on."""

    __tablename__ = "memory_feedback"
    __table_args__ = (
        UniqueConstraint("memory_id", "user_id", "query", name="uq_feedback_memory_user_query"),
    )

    id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=_uuid)
    memory_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("memories.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    rating: Mapped[int] = mapped_column(nullable=False)  # +1 or -1
    # The query that surfaced it — a rating without it cannot be learned from.
    query: Mapped[str] = mapped_column(String(500), nullable=False, default="")


class AuditLog(Base, TimestampMixin):
    __tablename__ = "audit_log"
    __table_args__ = (Index("ix_audit_org_created", "org_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    org_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("orgs.id", ondelete="CASCADE"), nullable=False
    )
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    target: Mapped[str | None] = mapped_column(Text)
