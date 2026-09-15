"""Topics on a skill: the tags a catalogue is browsed by.

The catalogue card and the skill's own header had nothing to say what a skill
is *about*. `topic` existed but holds one free-text string, set only on
distilled skills, so nineteen of twenty were blank.

Topics are derived from the skill's own text when it is published, which is the
only moment the information is free — somebody is handing us the document.

Revision ID: a1b2c3d4e5f6
Revises: f7a8b9c0d1e2
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "f7a8b9c0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # JSONB rather than text[]: Drizzle reads it without a custom type, and a
    # tag list is never queried by element — it is read whole with the row.
    op.add_column(
        "skills",
        sa.Column(
            "topics",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("skills", "topics")
