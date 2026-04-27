"""Student-owned theory marks (Path B manual entry)."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete

from app.core.exceptions import ForbiddenError, ValidationError
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.course import Course, Enrollment
from app.models.enums import CourseType, Role
from app.models.user import User
from app.schemas.courses import PatchMyTheoryMarksBody
from app.services import courses_service

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@theorymarks.test"


async def test_patch_my_theory_marks_updates_student_columns_only() -> None:
    async with AsyncSessionLocal() as db:
        stu_email = _email("stu")
        course = Course(
            course_code=f"TH{uuid.uuid4().hex[:6]}",
            course_name="Theory Course",
            course_type=CourseType.THEORY,
        )
        db.add(course)
        await db.flush()

        student = User(
            name="Theory Student",
            email=stu_email,
            university_name="Test University",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add(student)
        await db.flush()

        enr = Enrollment(
            user_id=student.id,
            course_id=course.id,
            ct_score1=99.0,
            ct_score2=88.0,
            lab_score=77.0,
        )
        db.add(enr)
        await db.commit()

        try:
            out = await courses_service.patch_my_theory_marks(
                db,
                course.id,
                student.id,
                PatchMyTheoryMarksBody(classTest1=12.0, classTest2=15.0),
            )
            assert out["studentTheoryMarks"]["classTest1"] == 12.0
            assert out["studentTheoryMarks"]["classTest2"] == 15.0
            assert out["studentTheoryMarks"]["classTest3"] is None
            assert out["studentTheoryMarks"]["assignment"] is None

            await db.refresh(enr)
            assert enr.student_theory_ct1 == 12.0
            assert enr.student_theory_ct2 == 15.0
            assert enr.ct_score1 == 99.0
            assert enr.lab_score == 77.0

            out2 = await courses_service.patch_my_theory_marks(
                db,
                course.id,
                student.id,
                PatchMyTheoryMarksBody.model_validate({"classTest1": None}),
            )
            assert out2["studentTheoryMarks"]["classTest1"] is None
        finally:
            await db.execute(delete(Enrollment).where(Enrollment.id == enr.id))
            await db.execute(delete(User).where(User.id == student.id))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


async def test_patch_my_theory_marks_rejects_lab_course() -> None:
    async with AsyncSessionLocal() as db:
        stu_email = _email("stu2")
        course = Course(
            course_code=f"LB{uuid.uuid4().hex[:6]}",
            course_name="Lab Course",
            course_type=CourseType.LAB,
        )
        db.add(course)
        await db.flush()
        student = User(
            name="Lab Student",
            email=stu_email,
            university_name="Test University",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add(student)
        await db.flush()
        enr = Enrollment(user_id=student.id, course_id=course.id)
        db.add(enr)
        await db.commit()
        try:
            with pytest.raises(ValidationError):
                await courses_service.patch_my_theory_marks(
                    db,
                    course.id,
                    student.id,
                    PatchMyTheoryMarksBody(classTest1=10.0),
                )
        finally:
            await db.execute(delete(Enrollment).where(Enrollment.id == enr.id))
            await db.execute(delete(User).where(User.id == student.id))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


async def test_patch_my_theory_marks_requires_enrollment() -> None:
    async with AsyncSessionLocal() as db:
        course = Course(
            course_code=f"TH{uuid.uuid4().hex[:6]}",
            course_name="Theory Course",
            course_type=CourseType.THEORY,
        )
        db.add(course)
        await db.flush()
        stu_email = _email("orphan")
        student = User(
            name="No Enroll",
            email=stu_email,
            university_name="Test University",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add(student)
        await db.commit()
        try:
            with pytest.raises(ForbiddenError):
                await courses_service.patch_my_theory_marks(
                    db,
                    course.id,
                    student.id,
                    PatchMyTheoryMarksBody(classTest1=1.0),
                )
        finally:
            await db.execute(delete(User).where(User.id == student.id))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()
