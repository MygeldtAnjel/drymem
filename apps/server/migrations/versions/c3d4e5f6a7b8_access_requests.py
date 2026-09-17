"""Access requests: the queue behind the landing page's form.

drymem is not self-serve. `POST /auth/signup` succeeds exactly once per server,
so the way a new team arrives is that somebody asks and an operator provisions
them with `drymem-admin org-create`. Until now "somebody asks" had nowhere to
land except an inbox.

One row per request, with the decision recorded on it. Kept after approval
rather than deleted: who asked, when, and who let them in is the only record of
how an organisation came to exist.

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c3d4e5f6a7b8"
down_revision: str | Sequence[str] | None = "b2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "access_requests",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False),
        sa.Column("name", sa.String(200), nullable=True),
        sa.Column("company", sa.String(200), nullable=True),
        # What they are trying to do. The one field worth reading before
        # deciding, so it is long enough to hold a real answer.
        sa.Column("about", sa.String(2000), nullable=True),
        sa.Column("team_size", sa.String(40), nullable=True),
        # pending | approved | declined. Free text rather than an enum: the
        # states of a manual queue change more often than a migration is worth.
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("note", sa.String(2000), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "decided_by",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        # Every timestamp defaults in the database (PLAN.md D41): a column that
        # relies on the application to fill it is null for whoever forgets.
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("source_ip", sa.String(64), nullable=True),
    )
    # Asking twice is not an error worth a 409 — a second row is a second
    # nudge — so the index sorts the queue rather than constraining it.
    op.create_index("ix_access_requests_created", "access_requests", ["created_at"])
    op.create_index("ix_access_requests_status", "access_requests", ["status"])
    op.create_index("ix_access_requests_email", "access_requests", ["email"])


def downgrade() -> None:
    op.drop_index("ix_access_requests_email", table_name="access_requests")
    op.drop_index("ix_access_requests_status", table_name="access_requests")
    op.drop_index("ix_access_requests_created", table_name="access_requests")
    op.drop_table("access_requests")
