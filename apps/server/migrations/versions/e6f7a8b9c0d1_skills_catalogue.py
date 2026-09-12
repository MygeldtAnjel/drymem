"""The skills catalogue: org-wide skills, immutable versions, per-project pins.

The old `skills` table was one row per published draft, scoped to a project.
The catalogue is org-wide, versioned, and a project *enables* a version from it
— which is what makes "the lead adds a skill, the coworker runs git pull" work
at all.

The rows that exist are migrated rather than dropped: each becomes a catalogue
entry with a version 1 holding its content, enabled for the project it was
published to. Nobody loses a skill to a schema change.

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e6f7a8b9c0d1"
down_revision: str | Sequence[str] | None = "d5e6f7a8b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ---- the catalogue entry -------------------------------------------------
    op.add_column("skills", sa.Column("description", sa.Text(), nullable=True))
    op.add_column(
        "skills", sa.Column("scope", sa.String(length=20), nullable=False, server_default="org")
    )
    op.add_column(
        "skills",
        sa.Column("source", sa.String(length=20), nullable=False, server_default="distilled"),
    )
    op.add_column(
        "skills",
        sa.Column("state", sa.String(length=20), nullable=False, server_default="published"),
    )
    op.add_column("skills", sa.Column("origin", sa.String(length=300), nullable=True))
    # A catalogue entry belongs to the org. `project_id` stays only for
    # project-scoped skills, so it has to become nullable.
    op.alter_column("skills", "project_id", nullable=True)
    op.drop_constraint("uq_skills_project_name", "skills", type_="unique")
    op.create_unique_constraint("uq_skills_org_name", "skills", ["org_id", "name"])

    # ---- versions ------------------------------------------------------------
    op.create_table(
        "skill_versions",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "skill_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("skills.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        # Extra files beside SKILL.md, as {path: text}. Empty for most skills.
        sa.Column("files", sa.JSON(), nullable=False, server_default="{}"),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("memory_count", sa.Integer(), nullable=False, server_default="0"),
        # What the scanner found. Empty list means clean.
        sa.Column("findings", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column(
            "created_by", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column("note", sa.String(length=300), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("skill_id", "version", name="uq_skill_version"),
    )
    op.create_index("ix_skill_versions_skill", "skill_versions", ["skill_id"])

    # ---- what a project has enabled -----------------------------------------
    op.create_table(
        "project_skills",
        sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "project_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "skill_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("skills.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "version_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("skill_versions.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "enabled_by", sa.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL")
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("project_id", "skill_id", name="uq_project_skill"),
    )
    op.create_index("ix_project_skills_project", "project_skills", ["project_id"])

    # ---- telemetry -----------------------------------------------------------
    op.create_table(
        "skill_uses",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("org_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("project_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("skill_id", sa.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", sa.UUID(as_uuid=True), nullable=True),
        sa.Column("agent", sa.String(length=40), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_index("ix_skill_uses_skill", "skill_uses", ["skill_id", "created_at"])

    # ---- carry the existing rows across --------------------------------------
    op.execute(
        """
        INSERT INTO skill_versions (
            id, skill_id, version, content, files, sha256, model, memory_count,
            findings, created_by, note, created_at
        )
        SELECT gen_random_uuid(), s.id, 1, s.content, '{}', encode(sha256(s.content::bytea), 'hex'),
               s.model, s.memory_count, '[]', s.author_id, 'Carried over from the first catalogue',
               s.created_at
        FROM skills s
        """
    )
    op.execute(
        """
        INSERT INTO project_skills (id, project_id, skill_id, version_id, enabled_by, created_at)
        SELECT gen_random_uuid(), s.project_id, s.id, v.id, s.author_id, s.created_at
        FROM skills s
        JOIN skill_versions v ON v.skill_id = s.id AND v.version = 1
        WHERE s.project_id IS NOT NULL
        """
    )
    op.execute("UPDATE skills SET description = topic WHERE description IS NULL")
    # They were published to one project, so that is the scope they had.
    op.execute("UPDATE skills SET scope = 'project' WHERE project_id IS NOT NULL")

    # `content` now lives on the version. Keeping a second copy on the skill is
    # how the two drift.
    op.drop_column("skills", "content")
    op.drop_column("skills", "model")
    op.drop_column("skills", "memory_count")


def downgrade() -> None:
    op.add_column("skills", sa.Column("content", sa.Text(), nullable=False, server_default=""))
    op.add_column("skills", sa.Column("model", sa.String(length=100), nullable=True))
    op.add_column(
        "skills", sa.Column("memory_count", sa.Integer(), nullable=False, server_default="0")
    )
    op.execute(
        """
        UPDATE skills s SET content = v.content, model = v.model, memory_count = v.memory_count
        FROM skill_versions v
        WHERE v.skill_id = s.id AND v.version = (
            SELECT max(version) FROM skill_versions WHERE skill_id = s.id
        )
        """
    )
    op.drop_table("skill_uses")
    op.drop_table("project_skills")
    op.drop_table("skill_versions")
    op.drop_constraint("uq_skills_org_name", "skills", type_="unique")
    op.execute("DELETE FROM skills WHERE project_id IS NULL")
    op.alter_column("skills", "project_id", nullable=False)
    op.create_unique_constraint("uq_skills_project_name", "skills", ["project_id", "name"])
    for column in ("origin", "state", "source", "scope", "description"):
        op.drop_column("skills", column)
