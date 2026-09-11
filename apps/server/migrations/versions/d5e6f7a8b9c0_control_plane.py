"""Password resets and subscriptions — the control plane's own tables.

Created here rather than by the Express service because Alembic is the single
schema authority for this database (PLAN.md D41). The API reads and writes
these; it never creates them.

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d5e6f7a8b9c0"
down_revision: str | Sequence[str] | None = "c4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "password_resets",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("requested_ip", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_password_resets_user", "password_resets", ["user_id"])
    op.create_index(
        "ix_password_resets_token_hash", "password_resets", ["token_hash"], unique=True
    )

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "org_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("plan", sa.String(length=40), nullable=False, server_default="free"),
        sa.Column("status", sa.String(length=40), nullable=False, server_default="active"),
        sa.Column("seats", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stripe_customer_id", sa.String(length=120), nullable=True),
        sa.Column("stripe_subscription_id", sa.String(length=120), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "cancel_at_period_end", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )


def downgrade() -> None:
    op.drop_table("subscriptions")
    op.drop_index("ix_password_resets_token_hash", table_name="password_resets")
    op.drop_index("ix_password_resets_user", table_name="password_resets")
    op.drop_table("password_resets")
