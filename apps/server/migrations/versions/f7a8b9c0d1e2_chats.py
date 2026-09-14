"""Chats: a conversation with the project's memory, kept.

Asking used to be one box and one answer, thrown away the moment you navigated.
A question is rarely the whole thought — the second one is usually "and why?"
— so a conversation needs turns, and turns are worth keeping.

Two tables. A `chat` belongs to one person and one project. A `chat_message` is
one turn, and an assistant turn records the memories it cited so the links still
work when the answer is read back a week later.

**Private to the person who asked.** A chat is a record of what somebody did not
know, which is not a thing to share with their team by default. There is no
scope column because there is no sharing to describe yet.

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f7a8b9c0d1e2"
down_revision: str | Sequence[str] | None = "e6f7a8b9c0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "chats",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "org_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("orgs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "project_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("projects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # The first question, trimmed. Renaming is a later luxury; a list of
        # "New chat" is a list of nothing.
        sa.Column("title", sa.String(200), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # Touched on every turn, because the list is ordered by most recent
        # activity and not by when the chat was started.
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_chats_user_updated", "chats", ["user_id", "updated_at"])
    op.create_index("ix_chats_project", "chats", ["project_id"])

    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "chat_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("chats.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        # Which memories the answer stood on, as the engine returned them:
        # index, uuid, title, author, type, created_at. Stored rather than
        # re-derived, so a link in an old answer still points at what was cited
        # and not at what the same question would retrieve today.
        sa.Column(
            "sources", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        # An ungrounded turn is one where the memory had nothing. Recorded so
        # "the model made this up" is never a question anyone has to ask.
        sa.Column("grounded", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("model", sa.String(100), nullable=False, server_default=""),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_chat_messages_chat", "chat_messages", ["chat_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_chat", table_name="chat_messages")
    op.drop_table("chat_messages")
    op.drop_index("ix_chats_project", table_name="chats")
    op.drop_index("ix_chats_user_updated", table_name="chats")
    op.drop_table("chats")
