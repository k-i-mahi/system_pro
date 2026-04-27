"""Backfill ScheduleSlot.ownerUserId for courses with exactly one student enrollment.

Pre-0006 rows all have ownerUserId NULL. After 0006, NULL means *shared* (tutor class
timetable). Legacy student-personal rows on single-student courses can be assigned
unambiguously to that student.

Courses with 2+ student enrollments are unchanged: ownership cannot be inferred from
the DB alone. After deploy, for a known course/user pair (e.g. from support tickets),
operators can run:

    UPDATE "ScheduleSlot"
    SET "ownerUserId" = '<student_user_id>'
    WHERE "courseId" = '<course_id>'
      AND "dayOfWeek" = 'SUN'
      AND "startTime" = '11:00'
      AND "ownerUserId" IS NULL;

Delete rows that are duplicate personal grids with no owner instead of assigning,
if that matches the product decision.

Student-facing reminders, post-class attendance prompts, and course todayAttendance
(for Role.STUDENT) only consider rows where ownerUserId matches the viewer, so legacy
NULL rows on multi-student courses no longer drive those features for every enrollee.
Community "shared" timetable still lists ownerUserId IS NULL slots; curate those
separately if the classroom view should match official department time only.

Revision ID: 0007
Revises: 0006
"""

from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    conn = op.get_bind()
    # One row per course that has exactly one STUDENT enrollment (MIN is deterministic).
    pairs = conn.execute(
        sa.text(
            """
            SELECT e."courseId" AS course_id, MIN(e."userId") AS user_id
            FROM "Enrollment" e
            INNER JOIN "User" u ON u.id = e."userId"
            WHERE u.role = 'STUDENT'
            GROUP BY e."courseId"
            HAVING COUNT(*) = 1
            """
        )
    ).mappings().all()

    for row in pairs:
        conn.execute(
            sa.text(
                """
                UPDATE "ScheduleSlot"
                SET "ownerUserId" = :uid
                WHERE "courseId" = :cid AND "ownerUserId" IS NULL
                """
            ),
            {"uid": row["user_id"], "cid": row["course_id"]},
        )


def downgrade() -> None:
    # Cannot distinguish auto-backfilled rows from intentional shared tutor slots.
    pass
