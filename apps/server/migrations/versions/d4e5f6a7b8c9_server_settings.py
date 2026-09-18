"""Server settings that an owner can change without a shell.

Some configuration is genuinely operational — the sending address for
invitations, which model does extraction — and making somebody edit a file and
restart the stack to change it is friction with no safety bought.

Some is not, and is deliberately absent: the database URLs stay in the
environment. A setting that decides *where the data lives* should need shell
access, and a wrong one typed into a browser would take away the browser you
would fix it with.

One row, enforced by a check constraint. This is server configuration, not an
organisation's, so there is nothing to scope it by.

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: str | Sequence[str] | None = "c3d4e5f6a7b8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "server_settings",
        # Always 1. The constraint is what makes "the settings" a thing rather
        # than a list nobody agreed the order of.
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.CheckConstraint("id = 1", name="ck_server_settings_single_row"),
        # Null means "not configured here" and the environment is used instead,
        # which is how an install that was set up by hand keeps working.
        sa.Column("resend_api_key", sa.String(200), nullable=True),
        sa.Column("email_from", sa.String(320), nullable=True),
        sa.Column("extractor", sa.String(20), nullable=True),
        sa.Column("local_llm_model", sa.String(200), nullable=True),
        sa.Column("anthropic_api_key", sa.String(200), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # The row exists from the start so every read is a read, never a read that
    # might have to create something.
    op.execute("INSERT INTO server_settings (id) VALUES (1)")


def downgrade() -> None:
    op.drop_table("server_settings")
