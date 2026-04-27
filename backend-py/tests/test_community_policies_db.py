"""Service-level policy tests (DB-backed): eligible classrooms, marks list, tutor attendance."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete

from app.core.exceptions import ForbiddenError
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.community import Community, CommunityMember
from app.models.course import Course, Enrollment
from app.models.enums import CommunityRole, Role
from app.models.user import User
from app.services import community_service


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@copilot-policy.test"


@pytest.mark.asyncio
async def test_eligible_tab_student_sees_classroom_when_enrolled_even_if_university_differs() -> None:
    """Students: eligible OR (same university OR enrolled in course)."""
    async with AsyncSessionLocal() as db:
        student_email = _email("stu")
        course = Course(course_code=f"POL{uuid.uuid4().hex[:6]}", course_name="Policy Course")
        db.add(course)
        await db.flush()

        student = User(
            name="Policy Student",
            email=student_email,
            university_name="Local University",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add(student)
        await db.flush()

        db.add(Enrollment(user_id=student.id, course_id=course.id))
        comm = Community(
            name="Other Uni Classroom",
            course_id=course.id,
            course_code=course.course_code,
            session="2025-26",
            department="CSE",
            university="Far Away University",
            created_by=student.id,
        )
        db.add(comm)
        await db.flush()
        await db.commit()

        try:
            rows, total = await community_service.list_communities(db, student.id, "eligible", 1, 50)
            ids = {r["id"] for r in rows}
            assert comm.id in ids
            assert total >= 1
        finally:
            await db.execute(delete(CommunityMember).where(CommunityMember.community_id == comm.id))
            await db.execute(delete(Community).where(Community.id == comm.id))
            await db.execute(delete(Enrollment).where(Enrollment.course_id == course.id))
            await db.execute(delete(User).where(User.id == student.id))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


@pytest.mark.asyncio
async def test_get_community_scores_excludes_tutor_even_if_enrolled() -> None:
    """Marks table uses classroom student members only (not tutors/co-tutors)."""
    async with AsyncSessionLocal() as db:
        tutor_email = _email("tut")
        stu_email = _email("stu2")
        course = Course(course_code=f"MRK{uuid.uuid4().hex[:6]}", course_name="Marks Course")
        db.add(course)
        await db.flush()

        tutor = User(
            name="Marks Tutor",
            email=tutor_email,
            university_name="Test University",
            password_hash=hash_password("Password123"),
            role=Role.TUTOR,
        )
        student = User(
            name="Marks Student",
            email=stu_email,
            university_name="Test University",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
            roll_number=f"R{uuid.uuid4().hex[:8]}",
        )
        db.add_all([tutor, student])
        await db.flush()

        enr_tutor = Enrollment(user_id=tutor.id, course_id=course.id, ct_score1=99.0)
        enr_stu = Enrollment(user_id=student.id, course_id=course.id, ct_score1=12.0)
        db.add_all([enr_tutor, enr_stu])

        comm = Community(
            name="Marks Community",
            course_id=course.id,
            course_code=course.course_code,
            session="2025-26",
            department="CSE",
            university="Test University",
            created_by=tutor.id,
        )
        db.add(comm)
        await db.flush()
        db.add_all([
            CommunityMember(community_id=comm.id, user_id=tutor.id, role=CommunityRole.TUTOR),
            CommunityMember(community_id=comm.id, user_id=student.id, role=CommunityRole.STUDENT),
        ])
        await db.commit()

        try:
            scores = await community_service.get_community_scores(db, comm.id)
            user_ids = {row["userId"] for row in scores}
            assert student.id in user_ids
            assert tutor.id not in user_ids
            st_row = next(r for r in scores if r["userId"] == student.id)
            assert st_row["ctScore1"] == 12.0
        finally:
            await db.execute(delete(CommunityMember).where(CommunityMember.community_id == comm.id))
            await db.execute(delete(Community).where(Community.id == comm.id))
            await db.execute(delete(Enrollment).where(Enrollment.course_id == course.id))
            await db.execute(delete(User).where(User.id.in_([tutor.id, student.id])))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


@pytest.mark.asyncio
async def test_record_attendance_forbidden_for_tutor_manager() -> None:
    """Instructors cannot use roll-call attendance even when they manage the classroom."""
    async with AsyncSessionLocal() as db:
        tutor_email = _email("tut3")
        course = Course(course_code=f"ATT{uuid.uuid4().hex[:6]}", course_name="Att Course")
        db.add(course)
        await db.flush()

        tutor = User(
            name="Att Tutor",
            email=tutor_email,
            university_name="Test University",
            password_hash=hash_password("Password123"),
            role=Role.TUTOR,
        )
        db.add(tutor)
        await db.flush()

        comm = Community(
            name="Att Community",
            course_id=course.id,
            course_code=course.course_code,
            session="2025-26",
            department="CSE",
            university="Test University",
            created_by=tutor.id,
        )
        db.add(comm)
        await db.flush()
        db.add(CommunityMember(community_id=comm.id, user_id=tutor.id, role=CommunityRole.TUTOR))
        await db.commit()

        try:
            with pytest.raises(ForbiddenError):
                await community_service.record_attendance(
                    db,
                    comm.id,
                    tutor.id,
                    slot_id="nonexistent-slot",
                    date_str="2026-01-15T00:00:00+00:00",
                    records=[{"userId": tutor.id, "present": True}],
                )
        finally:
            await db.execute(delete(CommunityMember).where(CommunityMember.community_id == comm.id))
            await db.execute(delete(Community).where(Community.id == comm.id))
            await db.execute(delete(User).where(User.id == tutor.id))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()
