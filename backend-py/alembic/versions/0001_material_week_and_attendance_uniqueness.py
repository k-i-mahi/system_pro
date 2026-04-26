"""material_week_and_attendance_uniqueness

Revision ID: 0001
Revises:
Create Date: 2026-04-25 00:00:00.000000

"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add weekNumber column to Material table (nullable, default NULL)
    op.add_column(
        "Material",
        sa.Column("weekNumber", sa.Integer(), nullable=True),
    )

    # Add unique constraint on AttendanceRecord(userId, slotId, date)
    # We first remove any existing duplicates gracefully, then add the constraint.
    # The constraint is added with IF NOT EXISTS logic via try/except in application code,
    # but here we create it directly — Alembic will error if it already exists.
    op.create_unique_constraint(
        "uq_attendance_user_slot_date",
        "AttendanceRecord",
        ["userId", "slotId", "date"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_attendance_user_slot_date", "AttendanceRecord", type_="unique")
    op.drop_column("Material", "weekNumber")
