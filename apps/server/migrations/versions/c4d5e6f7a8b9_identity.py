"""Identity: passwords, org roles, browser sessions, invites, device codes.

Also renames the project role `admin` to `lead` and gives projects a capture
mode. Everything is additive or defaulted: users created before identity keep
working through their API tokens and simply have no password until they set one.

Revision ID: c4d5e6f7a8b9
Revises: 8c31d0a7f4b2
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4d5e6f7a8b9"
down_revision: str | Sequence[str] | None = "8c31d0a7f4b2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(length=300), nullable=True))
    op.add_column(
        "users", sa.Column("role", sa.String(length=20), nullable=False, server_default="member")
    )
    # The first user of each org was implicitly its owner; make that explicit.
    op.execute(
        """
        UPDATE users u SET role = 'owner'
        WHERE u.id = (SELECT id FROM users WHERE org_id = u.org_id ORDER BY created_at LIMIT 1)
        """
    )

    op.add_column(
        "projects",
        sa.Column("capture_mode", sa.String(length=20), nullable=False, server_default="automatic"),
    )
    op.execute("UPDATE project_members SET role = 'lead' WHERE role = 'admin'")
    # A project made before roles existed has nobody who can run it. Its first
    # member becomes lead — the same rule `ensure_project` applies to new ones.
    op.execute(
        """
        UPDATE project_members pm SET role = 'lead'
        WHERE pm.id = (
            SELECT id FROM project_members WHERE project_id = pm.project_id
            ORDER BY created_at LIMIT 1
        )
        AND NOT EXISTS (
            SELECT 1 FROM project_members x WHERE x.project_id = pm.project_id AND x.role = 'lead'
        )
        """
    )

    op.create_table(
        "web_sessions",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=300), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_web_sessions_user_id", "web_sessions", ["user_id"])
    op.create_index("ix_web_sessions_token_hash", "web_sessions", ["token_hash"], unique=True)

    op.create_table(
        "invites",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "org_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False, server_default="member"),
        sa.Column(
            "project_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "invited_by",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_invites_org_id", "invites", ["org_id"])
    op.create_index("ix_invites_token_hash", "invites", ["token_hash"], unique=True)

    op.create_table(
        "device_codes",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column("device_hash", sa.String(length=64), nullable=False),
        sa.Column("user_code", sa.String(length=12), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("issued_token", sa.String(length=200), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_device_codes_device_hash", "device_codes", ["device_hash"], unique=True)
    op.create_index("ix_device_codes_user_code", "device_codes", ["user_code"], unique=True)


def downgrade() -> None:
    op.drop_table("device_codes")
    op.drop_table("invites")
    op.drop_table("web_sessions")
    op.execute("UPDATE project_members SET role = 'admin' WHERE role = 'lead'")
    op.drop_column("projects", "capture_mode")
    op.drop_column("users", "role")
    op.drop_column("users", "password_hash")
