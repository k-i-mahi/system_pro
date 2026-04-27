"""Explicit validation tests for manual Add Course (bulk_create_courses)."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select

from app.core.exceptions import ValidationError
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.course import Course, Enrollment
from app.models.enums import DayOfWeek, Role, SlotType
from app.models.user import User
from app.schemas.routine import BulkCourseInput, BulkCreateCoursesRequest, SlotInput
from app.services import routine_service
from app.services.course_identity import normalize_course_code

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@routineval.test"


async def test_bulk_create_rejects_end_before_start() -> None:
    async with AsyncSessionLocal() as db:
        email = _email("u1")
        user = User(
            name="Routine User",
            email=email,
            university_name="Test University",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add(user)
        await db.commit()
        try:
            body = BulkCreateCoursesRequest(
                courses=[
                    BulkCourseInput(
                        courseCode=f"BAD{uuid.uuid4().hex[:4]}",
                        courseName="Bad Times",
                        slots=[
                            SlotInput(
                                dayOfWeek=DayOfWeek.MON,
                                startTime="11:00",
                                endTime="10:00",
                                type=SlotType.CLASS,
                            )
                        ],
                    )
                ]
            )
            with pytest.raises(ValidationError, match="Schedule conflict|End time|valid slot"):
                await routine_service.bulk_create_courses(db, user.id, body)
        finally:
            await db.execute(delete(User).where(User.id == user.id))
            await db.commit()


async def test_bulk_create_rejects_same_day_overlap_with_existing_slot() -> None:
    async with AsyncSessionLocal() as db:
        email = _email("u2")
        user = User(
            name="Routine User 2",
            email=email,
            university_name="Test University",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add(user)
        await db.flush()

        code_a = f"A{uuid.uuid4().hex[:6]}"
        body1 = BulkCreateCoursesRequest(
            courses=[
                BulkCourseInput(
                    courseCode=code_a,
                    courseName="First",
                    slots=[
                        SlotInput(
                            dayOfWeek=DayOfWeek.TUE,
                            startTime="09:00",
                            endTime="10:30",
                            type=SlotType.CLASS,
                        )
                    ],
                )
            ]
        )
        await routine_service.bulk_create_courses(db, user.id, body1)

        course_a = (
            await db.execute(select(Course).where(Course.course_code == normalize_course_code(code_a)))
        ).scalar_one_or_none()
        assert course_a is not None
        enr = (
            await db.execute(
                select(Enrollment).where(Enrollment.user_id == user.id, Enrollment.course_id == course_a.id)
            )
        ).scalar_one_or_none()
        assert enr is not None

        code_b = f"B{uuid.uuid4().hex[:6]}"
        body2 = BulkCreateCoursesRequest(
            courses=[
                BulkCourseInput(
                    courseCode=code_b,
                    courseName="Overlap",
                    slots=[
                        SlotInput(
                            dayOfWeek=DayOfWeek.TUE,
                            startTime="09:30",
                            endTime="11:00",
                            type=SlotType.CLASS,
                        )
                    ],
                )
            ]
        )
        try:
            with pytest.raises(ValidationError, match="Schedule conflict|valid slot"):
                await routine_service.bulk_create_courses(db, user.id, body2)
        finally:
            await db.execute(delete(Enrollment).where(Enrollment.user_id == user.id))
            await db.execute(delete(Course).where(Course.id == course_a.id))
            other = (
                await db.execute(select(Course).where(Course.course_code == normalize_course_code(code_b)))
            ).scalar_one_or_none()
            if other:
                await db.execute(delete(Course).where(Course.id == other.id))
            await db.execute(delete(User).where(User.id == user.id))
            await db.commit()
