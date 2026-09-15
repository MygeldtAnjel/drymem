"""A chat message needs an order that is not its timestamp.

Both rows of a turn are written in one statement, and Postgres `now()` is
transaction time — so a question and its answer carry the *identical*
`created_at`. Ordering by it is a tie, and a tie is resolved however the plan
feels like resolving it: the answer can render above the question, and no cursor
can page the transcript because "older than this timestamp" is ambiguous.

`seq` is the insertion order, and there is nothing to tie.

Existing rows are numbered by timestamp with the user's turn placed first,
because that is the only order a turn can have been written in.

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("chat_messages", sa.Column("seq", sa.BigInteger(), nullable=True))

    # Numbered in the only order they can have happened in: by time, and within
    # one turn the question before the answer.
    op.execute(
        """
        WITH ordered AS (
            SELECT id,
                   row_number() OVER (
                       ORDER BY created_at,
                                CASE role WHEN 'user' THEN 0 ELSE 1 END,
                                id
                   ) AS n
            FROM chat_messages
        )
        UPDATE chat_messages m SET seq = ordered.n FROM ordered WHERE m.id = ordered.id
        """
    )

    op.execute("CREATE SEQUENCE chat_messages_seq_seq OWNED BY chat_messages.seq")
    op.execute(
        "SELECT setval('chat_messages_seq_seq', COALESCE((SELECT max(seq) FROM chat_messages), 0) + 1, false)"
    )
    op.execute(
        "ALTER TABLE chat_messages ALTER COLUMN seq SET DEFAULT nextval('chat_messages_seq_seq')"
    )
    op.alter_column("chat_messages", "seq", nullable=False)

    # The read is always "the newest N in this chat", so the index leads with
    # the chat and carries the order.
    op.create_index("ix_chat_messages_chat_seq", "chat_messages", ["chat_id", "seq"])


def downgrade() -> None:
    op.drop_index("ix_chat_messages_chat_seq", table_name="chat_messages")
    op.drop_column("chat_messages", "seq")
    op.execute("DROP SEQUENCE IF EXISTS chat_messages_seq_seq")
