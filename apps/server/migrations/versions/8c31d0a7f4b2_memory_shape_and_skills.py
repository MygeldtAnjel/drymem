"""Memory shape (type, session, team copy) and the skills registry.

Every column is nullable or defaulted: the memories written before today have
no type and no session, and a migration that demanded them would have to invent
values it cannot know.

Revision ID: 8c31d0a7f4b2
Revises: 462a58d295c1
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "8c31d0a7f4b2"
down_revision: str | Sequence[str] | None = "462a58d295c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "memories",
        sa.Column("memory_type", sa.String(length=30), nullable=False, server_default="note"),
    )
    op.add_column("memories", sa.Column("session_id", sa.String(length=64), nullable=True))
    op.add_column("memories", sa.Column("team_episode_uuid", sa.String(length=64), nullable=True))
    op.create_index("ix_memories_session", "memories", ["project_id", "session_id"])
    op.create_index("ix_memories_team_episode_uuid", "memories", ["team_episode_uuid"], unique=True)

    op.create_table(
        "skills",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "org_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "author_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("topic", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("memory_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("project_id", "name", name="uq_skills_project_name"),
    )
    op.create_index("ix_skills_org_id", "skills", ["org_id"])
    op.create_index("ix_skills_project_id", "skills", ["project_id"])


def downgrade() -> None:
    op.drop_table("skills")
    op.drop_index("ix_memories_team_episode_uuid", table_name="memories")
    op.drop_index("ix_memories_session", table_name="memories")
    op.drop_column("memories", "team_episode_uuid")
    op.drop_column("memories", "session_id")
    op.drop_column("memories", "memory_type")
