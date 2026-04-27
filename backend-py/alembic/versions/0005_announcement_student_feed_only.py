"""announcement_student_feed_only

Marks-upload and other student-facing system announcements (hidden from tutor classroom feed).

Revision ID: 0005
Revises: 0004
Create Date: 2026-04-26 18:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "Announcement",
        sa.Column("studentFeedOnly", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("Announcement", "studentFeedOnly")
