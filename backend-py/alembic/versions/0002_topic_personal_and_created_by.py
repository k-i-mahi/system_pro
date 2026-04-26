"""topic_personal_and_created_by

Adds isPersonal (bool) and createdBy (user FK) columns to the Topic table so
students can log personal study topics that don't appear in the shared course
topic list but do trigger attendance auto-marking.

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-25 12:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "Topic",
        sa.Column("isPersonal", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "Topic",
        sa.Column("createdBy", sa.String(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("Topic", "createdBy")
    op.drop_column("Topic", "isPersonal")
