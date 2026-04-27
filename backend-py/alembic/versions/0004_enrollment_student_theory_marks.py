"""enrollment_student_theory_marks

Student-owned theory marks (Path B: manual entry after tutor uploads mark file).

Revision ID: 0004
Revises: 0003
Create Date: 2026-04-26 14:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("Enrollment", sa.Column("studentTheoryCt1", sa.Float(), nullable=True))
    op.add_column("Enrollment", sa.Column("studentTheoryCt2", sa.Float(), nullable=True))
    op.add_column("Enrollment", sa.Column("studentTheoryCt3", sa.Float(), nullable=True))
    op.add_column("Enrollment", sa.Column("studentTheoryAssignment", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("Enrollment", "studentTheoryAssignment")
    op.drop_column("Enrollment", "studentTheoryCt3")
    op.drop_column("Enrollment", "studentTheoryCt2")
    op.drop_column("Enrollment", "studentTheoryCt1")
