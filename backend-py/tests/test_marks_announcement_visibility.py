"""Marks-upload announcements: student-feed-only visibility for community tutors."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.community import Announcement, Community, CommunityMember
from app.models.course import Course
from app.models.enums import CommunityRole, Role
from app.models.user import User
from app.services import community_service


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@marks-ann.test"


def _course_code() -> str:
    return f"M{uuid.uuid4().hex[:6]}"


@pytest.mark.asyncio
async def test_student_feed_only_hidden_from_tutor_in_announcement_list() -> None:
    async with AsyncSessionLocal() as db:
        code = _course_code()
        course = Course(course_code=code, course_name="Marks Vis")
        db.add(course)
        await db.flush()

        tutor = User(
            name="Tutor A",
            email=_email("tut"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.TUTOR,
        )
        stu = User(
            name="Student A",
            email=_email("stu"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add_all([tutor, stu])
        await db.flush()

        comm = Community(
            name="Class R",
            course_id=course.id,
            course_code=course.course_code,
            session="2025",
            department="CSE",
            university="U",
            created_by=tutor.id,
        )
        db.add(comm)
        await db.flush()

        db.add(CommunityMember(community_id=comm.id, user_id=tutor.id, role=CommunityRole.TUTOR))
        db.add(CommunityMember(community_id=comm.id, user_id=stu.id, role=CommunityRole.STUDENT))
        await db.flush()

        db.add(
            Announcement(
                community_id=comm.id,
                author_id=tutor.id,
                title="Normal",
                body="Hi",
                student_feed_only=False,
            )
        )
        db.add(
            Announcement(
                community_id=comm.id,
                author_id=tutor.id,
                title="Marks file posted",
                body="Student-facing",
                student_feed_only=True,
            )
        )
        await db.commit()

        try:
            tutor_items, tutor_total = await community_service.list_announcements(db, comm.id, tutor.id, 1, 20)
            assert tutor_total == 1
            assert len(tutor_items) == 1
            assert tutor_items[0]["title"] == "Normal"
            assert tutor_items[0]["studentFeedOnly"] is False

            stu_items, stu_total = await community_service.list_announcements(db, comm.id, stu.id, 1, 20)
            assert stu_total == 2
            titles = {x["title"] for x in stu_items}
            assert titles == {"Normal", "Marks file posted"}
        finally:
            await db.execute(delete(Announcement).where(Announcement.community_id == comm.id))
            await db.execute(delete(CommunityMember).where(CommunityMember.community_id == comm.id))
            await db.execute(delete(Community).where(Community.id == comm.id))
            await db.execute(delete(User).where(User.id.in_([tutor.id, stu.id])))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


@pytest.mark.asyncio
async def test_student_feed_only_hidden_when_viewer_is_admin_and_classroom_tutor() -> None:
    """Platform ADMIN who is also assigned TUTOR in the room must not see student-only feed rows."""
    async with AsyncSessionLocal() as db:
        code = _course_code()
        course = Course(course_code=code, course_name="Marks Vis Admin")
        db.add(course)
        await db.flush()

        tutor_admin = User(
            name="Admin Tutor",
            email=_email("admintut"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.ADMIN,
        )
        stu = User(
            name="Student B",
            email=_email("stub"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add_all([tutor_admin, stu])
        await db.flush()

        comm = Community(
            name="Class R2",
            course_id=course.id,
            course_code=course.course_code,
            session="2025",
            department="CSE",
            university="U",
            created_by=tutor_admin.id,
        )
        db.add(comm)
        await db.flush()

        db.add(CommunityMember(community_id=comm.id, user_id=tutor_admin.id, role=CommunityRole.TUTOR))
        db.add(CommunityMember(community_id=comm.id, user_id=stu.id, role=CommunityRole.STUDENT))
        await db.flush()

        db.add(
            Announcement(
                community_id=comm.id,
                author_id=tutor_admin.id,
                title="Normal",
                body="Hi",
                student_feed_only=False,
            )
        )
        db.add(
            Announcement(
                community_id=comm.id,
                author_id=tutor_admin.id,
                title="Marks file posted",
                body="Student-facing",
                student_feed_only=True,
            )
        )
        await db.commit()

        try:
            tutor_items, tutor_total = await community_service.list_announcements(db, comm.id, tutor_admin.id, 1, 20)
            assert tutor_total == 1
            assert tutor_items[0]["title"] == "Normal"

            stu_items, stu_total = await community_service.list_announcements(db, comm.id, stu.id, 1, 20)
            assert stu_total == 2
        finally:
            await db.execute(delete(Announcement).where(Announcement.community_id == comm.id))
            await db.execute(delete(CommunityMember).where(CommunityMember.community_id == comm.id))
            await db.execute(delete(Community).where(Community.id == comm.id))
            await db.execute(delete(User).where(User.id.in_([tutor_admin.id, stu.id])))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


@pytest.mark.asyncio
async def test_platform_admin_without_membership_does_not_see_student_only_announcements() -> None:
    """Admins use the same tutor classroom UI as instructors; they must not see student-feed-only rows."""
    async with AsyncSessionLocal() as db:
        code = _course_code()
        course = Course(course_code=code, course_name="Marks Vis Admin Only")
        db.add(course)
        await db.flush()

        tutor = User(
            name="Tutor Owner",
            email=_email("tutown"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.TUTOR,
        )
        admin_only = User(
            name="Platform Admin",
            email=_email("adm"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.ADMIN,
        )
        stu = User(
            name="Student C",
            email=_email("stuc"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add_all([tutor, admin_only, stu])
        await db.flush()

        comm = Community(
            name="Class R3",
            course_id=course.id,
            course_code=course.course_code,
            session="2025",
            department="CSE",
            university="U",
            created_by=tutor.id,
        )
        db.add(comm)
        await db.flush()

        db.add(CommunityMember(community_id=comm.id, user_id=tutor.id, role=CommunityRole.TUTOR))
        db.add(CommunityMember(community_id=comm.id, user_id=stu.id, role=CommunityRole.STUDENT))
        await db.flush()

        db.add(
            Announcement(
                community_id=comm.id,
                author_id=tutor.id,
                title="Normal",
                body="Hi",
                student_feed_only=False,
            )
        )
        db.add(
            Announcement(
                community_id=comm.id,
                author_id=tutor.id,
                title="Marks file posted",
                body="Student-facing",
                student_feed_only=True,
            )
        )
        await db.commit()

        try:
            admin_items, admin_total = await community_service.list_announcements(db, comm.id, admin_only.id, 1, 20)
            assert admin_total == 1
            assert admin_items[0]["title"] == "Normal"

            stu_items, stu_total = await community_service.list_announcements(db, comm.id, stu.id, 1, 20)
            assert stu_total == 2
        finally:
            await db.execute(delete(Announcement).where(Announcement.community_id == comm.id))
            await db.execute(delete(CommunityMember).where(CommunityMember.community_id == comm.id))
            await db.execute(delete(Community).where(Community.id == comm.id))
            await db.execute(delete(User).where(User.id.in_([tutor.id, admin_only.id, stu.id])))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


@pytest.mark.asyncio
async def test_classroom_creator_hides_student_only_even_without_community_member_row() -> None:
    """Creator is always instructor for the room; hide student-only even if Tutor membership row is missing."""
    async with AsyncSessionLocal() as db:
        code = _course_code()
        course = Course(course_code=code, course_name="Marks Vis Creator")
        db.add(course)
        await db.flush()

        tutor = User(
            name="Tutor Creator",
            email=_email("tutcr"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.TUTOR,
        )
        stu = User(
            name="Student D",
            email=_email("stud"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add_all([tutor, stu])
        await db.flush()

        comm = Community(
            name="Class R4",
            course_id=course.id,
            course_code=course.course_code,
            session="2025",
            department="CSE",
            university="U",
            created_by=tutor.id,
        )
        db.add(comm)
        await db.flush()

        db.add(CommunityMember(community_id=comm.id, user_id=stu.id, role=CommunityRole.STUDENT))
        await db.flush()

        db.add(
            Announcement(
                community_id=comm.id,
                author_id=tutor.id,
                title="Normal",
                body="Hi",
                student_feed_only=False,
            )
        )
        db.add(
            Announcement(
                community_id=comm.id,
                author_id=tutor.id,
                title="Marks file posted",
                body="Student-facing",
                student_feed_only=True,
            )
        )
        await db.commit()

        try:
            tutor_items, tutor_total = await community_service.list_announcements(db, comm.id, tutor.id, 1, 20)
            assert tutor_total == 1
            assert tutor_items[0]["title"] == "Normal"

            stu_items, stu_total = await community_service.list_announcements(db, comm.id, stu.id, 1, 20)
            assert stu_total == 2
        finally:
            await db.execute(delete(Announcement).where(Announcement.community_id == comm.id))
            await db.execute(delete(CommunityMember).where(CommunityMember.community_id == comm.id))
            await db.execute(delete(Community).where(Community.id == comm.id))
            await db.execute(delete(User).where(User.id.in_([tutor.id, stu.id])))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()
