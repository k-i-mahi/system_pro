"""enrollment_student_lab_marks

Student-owned lab marks (separate from tutor-uploaded ct/lab scores on Enrollment).

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-26 12:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("Enrollment", sa.Column("studentLabTest", sa.Float(), nullable=True))
    op.add_column("Enrollment", sa.Column("studentLabQuiz", sa.Float(), nullable=True))
    op.add_column("Enrollment", sa.Column("studentLabAssignment", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("Enrollment", "studentLabAssignment")
    op.drop_column("Enrollment", "studentLabQuiz")
    op.drop_column("Enrollment", "studentLabTest")
