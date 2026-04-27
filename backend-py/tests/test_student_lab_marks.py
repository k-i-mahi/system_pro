"""Student-owned lab marks: DB + service (separate from tutor enrollment scores)."""
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
from app.schemas.courses import PatchMyLabMarksBody
from app.services import courses_service

# Shared AsyncEngine must use one event loop for all tests (function scope creates a new loop per test and breaks the pool).
pytestmark = pytest.mark.asyncio(loop_scope="session")


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@labmarks.test"


async def test_patch_my_lab_marks_updates_only_student_columns() -> None:
    async with AsyncSessionLocal() as db:
        stu_email = _email("stu")
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
            out = await courses_service.patch_my_lab_marks(
                db,
                course.id,
                student.id,
                PatchMyLabMarksBody(labTest=12.0, labQuiz=15.0),
            )
            assert out["studentLabMarks"]["labTest"] == 12.0
            assert out["studentLabMarks"]["labQuiz"] == 15.0
            assert out["studentLabMarks"]["assignment"] is None

            await db.refresh(enr)
            assert enr.student_lab_test == 12.0
            assert enr.student_lab_quiz == 15.0
            assert enr.student_lab_assignment is None
            assert enr.ct_score1 == 99.0
            assert enr.lab_score == 77.0

            out2 = await courses_service.patch_my_lab_marks(
                db,
                course.id,
                student.id,
                PatchMyLabMarksBody.model_validate({"assignment": 30.0}),
            )
            assert out2["studentLabMarks"]["assignment"] == 30.0

            out3 = await courses_service.patch_my_lab_marks(
                db,
                course.id,
                student.id,
                PatchMyLabMarksBody.model_validate({"labTest": None}),
            )
            assert out3["studentLabMarks"]["labTest"] is None
            assert out3["studentLabMarks"]["labQuiz"] == 15.0
        finally:
            await db.execute(delete(Enrollment).where(Enrollment.id == enr.id))
            await db.execute(delete(User).where(User.id == student.id))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


async def test_patch_my_lab_marks_rejects_theory_course() -> None:
    async with AsyncSessionLocal() as db:
        stu_email = _email("stu2")
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
        enr = Enrollment(user_id=student.id, course_id=course.id)
        db.add(enr)
        await db.commit()
        try:
            with pytest.raises(ValidationError):
                await courses_service.patch_my_lab_marks(
                    db,
                    course.id,
                    student.id,
                    PatchMyLabMarksBody(labTest=10.0),
                )
        finally:
            await db.execute(delete(Enrollment).where(Enrollment.id == enr.id))
            await db.execute(delete(User).where(User.id == student.id))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


async def test_patch_my_lab_marks_other_student_enrollment_unchanged() -> None:
    async with AsyncSessionLocal() as db:
        e1 = _email("a")
        e2 = _email("b")
        course = Course(
            course_code=f"LB{uuid.uuid4().hex[:6]}",
            course_name="Shared Lab",
            course_type=CourseType.LAB,
        )
        db.add(course)
        await db.flush()
        s1 = User(
            name="A", email=e1, university_name="U", password_hash=hash_password("Password123"), role=Role.STUDENT
        )
        s2 = User(
            name="B", email=e2, university_name="U", password_hash=hash_password("Password123"), role=Role.STUDENT
        )
        db.add_all([s1, s2])
        await db.flush()
        enr1 = Enrollment(user_id=s1.id, course_id=course.id, student_lab_test=5.0)
        enr2 = Enrollment(user_id=s2.id, course_id=course.id, student_lab_test=9.0)
        db.add_all([enr1, enr2])
        await db.commit()
        try:
            await courses_service.patch_my_lab_marks(
                db,
                course.id,
                s1.id,
                PatchMyLabMarksBody.model_validate({"labTest": 11.0}),
            )
            await db.refresh(enr2)
            assert enr2.student_lab_test == 9.0
        finally:
            await db.execute(delete(Enrollment).where(Enrollment.course_id == course.id))
            await db.execute(delete(User).where(User.id.in_([s1.id, s2.id])))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


async def test_patch_my_lab_marks_forbidden_without_enrollment() -> None:
    async with AsyncSessionLocal() as db:
        stu_email = _email("stu3")
        course = Course(
            course_code=f"LB{uuid.uuid4().hex[:6]}",
            course_name="Lab Only",
            course_type=CourseType.LAB,
        )
        db.add(course)
        await db.flush()
        student = User(
            name="Stranger",
            email=stu_email,
            university_name="Test University",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add(student)
        await db.commit()
        try:
            with pytest.raises(ForbiddenError):
                await courses_service.patch_my_lab_marks(
                    db,
                    course.id,
                    student.id,
                    PatchMyLabMarksBody(labTest=1.0),
                )
        finally:
            await db.execute(delete(User).where(User.id == student.id))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()
