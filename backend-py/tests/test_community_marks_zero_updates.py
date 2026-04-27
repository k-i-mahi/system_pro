"""Marks upload must not notify students when no official marks were written."""
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import delete, select

from app.core.exceptions import ValidationError
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.community import Community, CommunityMember, MarkUpload
from app.models.course import Course, Enrollment
from app.models.enums import CommunityRole, Role
from app.models.misc import Notification
from app.models.user import User
from app.services import community_service


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@zero-marks.test"


@pytest.mark.asyncio
async def test_upload_marks_raises_and_skips_notifications_when_zero_updates() -> None:
    """Parsed rows that match no enrolled student → no announcement, no notifications."""
    csv_body = b"rollNumber,CT1\n99999999,99\n"

    async with AsyncSessionLocal() as db:
        course = Course(course_code=f"Z{uuid.uuid4().hex[:6]}", course_name="Z")
        db.add(course)
        await db.flush()

        tutor = User(
            name="Tutor",
            email=_email("t"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.TUTOR,
        )
        stu = User(
            name="Stu",
            email=_email("s"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
            roll_number="111",
        )
        db.add_all([tutor, stu])
        await db.flush()
        db.add(Enrollment(user_id=stu.id, course_id=course.id))

        comm = Community(
            name="C",
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
                CommunityMember(community_id=comm.id, user_id=stu.id, role=CommunityRole.STUDENT),
            ]
        )
        await db.commit()

        comm_id = comm.id
        tutor_id = tutor.id
        stu_id = stu.id
        course_id = course.id

    mock_upload = AsyncMock(return_value={"secure_url": "https://example.test/x.csv"})

    with patch("app.services.community_service.upload_file", mock_upload):
        async with AsyncSessionLocal() as db:
            with pytest.raises(ValidationError) as exc_info:
                await community_service.upload_marks(db, comm_id, tutor_id, csv_body, "x.csv", None)
            assert exc_info.value.status_code == 400
            detail = exc_info.value.detail
            assert isinstance(detail, dict) and "No official marks" in str(detail.get("message", ""))

    async with AsyncSessionLocal() as db:
        n = (await db.execute(select(Notification).where(Notification.user_id == stu_id))).scalars().all()
        assert not any(m.metadata_.get("kind") == "CT_MARKS_FILE_UPLOADED" for m in n)

        await db.execute(delete(MarkUpload).where(MarkUpload.community_id == comm_id))
        await db.execute(delete(CommunityMember).where(CommunityMember.community_id == comm_id))
        await db.execute(delete(Community).where(Community.id == comm_id))
        await db.execute(delete(Enrollment).where(Enrollment.course_id == course_id))
        await db.execute(delete(User).where(User.id.in_([tutor_id, stu_id])))
        await db.execute(delete(Course).where(Course.id == course_id))
        await db.commit()
