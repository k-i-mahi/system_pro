"""CT marks upload: enrollment updates + student notifications (Path B: csv/xlsx)."""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.community import Announcement, Community, CommunityMember, MarkUpload
from app.models.course import Course, Enrollment
from app.models.enums import CommunityRole, Role
from app.models.misc import Notification
from app.models.user import User
from app.services import community_service


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@marks-up.test"


def _course_code() -> str:
    return f"U{uuid.uuid4().hex[:6]}"


@pytest.mark.asyncio
async def test_upload_marks_updates_enrollment_and_notifies_students() -> None:
    csv_body = b"rollNumber,CT1\nR001,14.5\nR002,12\n"

    async with AsyncSessionLocal() as db:
        code = _course_code()
        course = Course(course_code=code, course_name="Marks Up")
        db.add(course)
        await db.flush()

        tutor = User(
            name="Tutor",
            email=_email("tut"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.TUTOR,
        )
        s1 = User(
            name="S1",
            email=_email("s1"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
            roll_number="R001",
        )
        s2 = User(
            name="S2",
            email=_email("s2"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
            roll_number="R002",
        )
        db.add_all([tutor, s1, s2])
        await db.flush()

        db.add_all(
            [
                Enrollment(user_id=s1.id, course_id=course.id),
                Enrollment(user_id=s2.id, course_id=course.id),
            ]
        )

        comm = Community(
            name="Class",
            course_id=course.id,
            course_code=course.course_code,
            session="2025",
            department="CSE",
            university="U",
            created_by=tutor.id,
        )
        db.add(comm)
        await db.flush()

        db.add_all(
            [
                CommunityMember(community_id=comm.id, user_id=tutor.id, role=CommunityRole.TUTOR),
                CommunityMember(community_id=comm.id, user_id=s1.id, role=CommunityRole.STUDENT),
                CommunityMember(community_id=comm.id, user_id=s2.id, role=CommunityRole.STUDENT),
            ]
        )
        await db.commit()

        comm_id = comm.id
        tutor_id = tutor.id
        s1_id = s1.id
        s2_id = s2.id
        course_id = course.id

    mock_upload = AsyncMock(return_value={"secure_url": "https://example.test/marks.csv"})

    with patch("app.services.community_service.upload_file", mock_upload):
        async with AsyncSessionLocal() as db:
            result = await community_service.upload_marks(
                db, comm_id, tutor_id, csv_body, "marks.csv", None
            )

    assert result["updated"] == 2
    assert result["processed"] == 2
    assert not result["errors"]

    async with AsyncSessionLocal() as db:
        e1 = (
            await db.execute(select(Enrollment).where(Enrollment.user_id == s1_id, Enrollment.course_id == course_id))
        ).scalar_one()
        e2 = (
            await db.execute(select(Enrollment).where(Enrollment.user_id == s2_id, Enrollment.course_id == course_id))
        ).scalar_one()
        assert e1.ct_score1 == 14.5
        assert e2.ct_score1 == 12.0

        n1 = (await db.execute(select(Notification).where(Notification.user_id == s1_id))).scalars().all()
        assert any("marks uploaded" in n.title.lower() for n in n1)
        n2 = (await db.execute(select(Notification).where(Notification.user_id == s2_id))).scalars().all()
        assert any(n.metadata_.get("kind") == "CT_MARKS_FILE_UPLOADED" for n in n2)

        await db.execute(delete(Notification).where(Notification.user_id.in_([s1_id, s2_id])))
        await db.execute(delete(Announcement).where(Announcement.community_id == comm_id))
        await db.execute(delete(MarkUpload).where(MarkUpload.community_id == comm_id))
        await db.execute(delete(CommunityMember).where(CommunityMember.community_id == comm_id))
        await db.execute(delete(Community).where(Community.id == comm_id))
        await db.execute(delete(Enrollment).where(Enrollment.course_id == course_id))
        await db.execute(delete(User).where(User.id.in_([tutor_id, s1_id, s2_id])))
        await db.execute(delete(Course).where(Course.id == course_id))
        await db.commit()
