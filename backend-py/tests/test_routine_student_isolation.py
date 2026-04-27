"""Student routine slots must not be shared across users enrolled in the same course."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.course import Course, Enrollment, ScheduleSlot
from app.models.enums import DayOfWeek, Role, SlotType
from app.models.user import User
from app.services import courses_service, routine_service


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@iso.routine.test"


@pytest.mark.asyncio
async def test_get_schedule_student_sees_only_own_slots_for_same_course() -> None:
    async with AsyncSessionLocal() as db:
        course = Course(course_code=f"ISO{uuid.uuid4().hex[:4]}", course_name="Iso Course")
        db.add(course)
        await db.flush()

        pa = _email("a")
        pb = _email("b")
        stu_a = User(
            name="A",
            email=pa,
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        stu_b = User(
            name="B",
            email=pb,
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add_all([stu_a, stu_b])
        await db.flush()

        db.add_all(
            [
                Enrollment(user_id=stu_a.id, course_id=course.id),
                Enrollment(user_id=stu_b.id, course_id=course.id),
            ]
        )

        db.add_all(
            [
                ScheduleSlot(
                    course_id=course.id,
                    owner_user_id=stu_a.id,
                    day_of_week=DayOfWeek.SUN,
                    start_time="11:00",
                    end_time="11:40",
                    type=SlotType.CLASS,
                ),
                ScheduleSlot(
                    course_id=course.id,
                    owner_user_id=stu_b.id,
                    day_of_week=DayOfWeek.TUE,
                    start_time="09:00",
                    end_time="10:00",
                    type=SlotType.CLASS,
                ),
                ScheduleSlot(
                    course_id=course.id,
                    owner_user_id=stu_b.id,
                    day_of_week=DayOfWeek.WED,
                    start_time="14:00",
                    end_time="15:00",
                    type=SlotType.CLASS,
                ),
            ]
        )
        await db.commit()

        try:
            sched_a = await routine_service.get_schedule(db, stu_a.id)
            assert len(sched_a) == 1
            assert sched_a[0]["dayOfWeek"] == DayOfWeek.SUN
            assert sched_a[0]["startTime"] == "11:00"

            sched_b = await routine_service.get_schedule(db, stu_b.id)
            days = {s["dayOfWeek"] for s in sched_b}
            assert days == {DayOfWeek.TUE, DayOfWeek.WED}
            assert DayOfWeek.SUN not in days
        finally:
            await db.execute(delete(ScheduleSlot).where(ScheduleSlot.course_id == course.id))
            await db.execute(delete(Enrollment).where(Enrollment.course_id == course.id))
            await db.execute(delete(User).where(User.id.in_([stu_a.id, stu_b.id])))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


@pytest.mark.asyncio
async def test_student_morning_reminders_only_personal_slots_multi_enrollment() -> None:
    """Legacy NULL (shared) slots must not generate student class reminders when 2+ students enroll."""
    from app.workers.notification_worker import _create_student_reminders

    async with AsyncSessionLocal() as db:
        course = Course(course_code=f"REM{uuid.uuid4().hex[:4]}", course_name="Rem Course")
        db.add(course)
        await db.flush()

        pa = _email("rem-a")
        pb = _email("rem-b")
        stu_a = User(
            name="RA",
            email=pa,
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
            timezone="UTC",
            notif_newest_update=True,
        )
        stu_b = User(
            name="RB",
            email=pb,
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add_all([stu_a, stu_b])
        await db.flush()
        db.add_all(
            [
                Enrollment(user_id=stu_a.id, course_id=course.id),
                Enrollment(user_id=stu_b.id, course_id=course.id),
            ]
        )
        db.add(
            ScheduleSlot(
                course_id=course.id,
                owner_user_id=None,
                day_of_week=DayOfWeek.MON,
                start_time="09:00",
                end_time="10:00",
                type=SlotType.CLASS,
            )
        )
        await db.commit()

        try:
            mock_create = AsyncMock()
            with patch("app.workers.notification_worker.notification_service.create_notification", mock_create):
                await _create_student_reminders(db, stu_a, DayOfWeek.MON, "2026-01-05")
            mock_create.assert_not_called()
        finally:
            await db.execute(delete(ScheduleSlot).where(ScheduleSlot.course_id == course.id))
            await db.execute(delete(Enrollment).where(Enrollment.course_id == course.id))
            await db.execute(delete(User).where(User.id.in_([stu_a.id, stu_b.id])))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


@pytest.mark.asyncio
async def test_student_today_attendance_ignores_null_owner_slot() -> None:
    """Course detail todayAttendance for students uses only slots they own (not legacy shared NULL)."""
    fixed_monday = datetime(2026, 1, 5, 12, 0, tzinfo=timezone.utc)

    async with AsyncSessionLocal() as db:
        course = Course(course_code=f"ATT{uuid.uuid4().hex[:4]}", course_name="Att Course")
        db.add(course)
        await db.flush()

        stu = User(
            name="S",
            email=_email("att"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
            timezone="UTC",
        )
        db.add(stu)
        await db.flush()
        db.add(Enrollment(user_id=stu.id, course_id=course.id))
        db.add(
            ScheduleSlot(
                course_id=course.id,
                owner_user_id=None,
                day_of_week=DayOfWeek.MON,
                start_time="09:00",
                end_time="10:00",
                type=SlotType.CLASS,
            )
        )
        await db.commit()

        try:
            with patch("app.services.courses_service.datetime") as mock_dt:
                mock_dt.now.return_value = fixed_monday
                mock_dt.combine = datetime.combine
                mock_dt.min = datetime.min
                detail = await courses_service.get_course_detail(db, course.id, stu.id)
            assert detail.get("todayAttendance") is None
        finally:
            await db.execute(delete(ScheduleSlot).where(ScheduleSlot.course_id == course.id))
            await db.execute(delete(Enrollment).where(Enrollment.course_id == course.id))
            await db.execute(delete(User).where(User.id == stu.id))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()
