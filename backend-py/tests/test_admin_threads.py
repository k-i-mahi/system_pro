"""Admin thread CRUD (service layer)."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete

from app.core.exceptions import ValidationError
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.community import Thread, ThreadPost
from app.models.course import Course
from app.models.enums import Role
from app.models.user import User
from app.services import admin_service


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@admin-thread.test"


@pytest.mark.asyncio
async def test_admin_thread_crud_requires_student_creator() -> None:
    async with AsyncSessionLocal() as db:
        stu = User(
            name="Stu",
            email=_email("s"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        tutor = User(
            name="T",
            email=_email("t"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.TUTOR,
        )
        db.add_all([stu, tutor])
        await db.flush()
        course = Course(course_code=f"A{uuid.uuid4().hex[:6]}", course_name="C")
        db.add(course)
        await db.commit()
        stu_id = stu.id
        tutor_id = tutor.id
        course_id = course.id

    async with AsyncSessionLocal() as db:
        with pytest.raises(ValidationError):
            await admin_service.create_thread(
                db,
                {"creatorUserId": tutor_id, "title": "x", "body": "y", "tags": []},
            )

        row = await admin_service.create_thread(
            db,
            {
                "creatorUserId": stu_id,
                "title": "Hello",
                "body": "World",
                "courseId": course_id,
                "tags": ["exam"],
            },
        )
        tid = row["id"]
        assert row["title"] == "Hello"
        assert row["replyCount"] == 0

        updated = await admin_service.update_thread(db, tid, {"title": "Hi", "tags": ["a", "b"]})
        assert updated["title"] == "Hi"
        assert updated["tags"] == ["a", "b"]

        db.add(ThreadPost(thread_id=tid, author_id=stu_id, content="p"))
        await db.commit()

        listed, total = await admin_service.list_threads(db, 1, 50, search="Hi")
        assert total >= 1
        assert any(r["id"] == tid for r in listed)

        await admin_service.delete_thread(db, tid)
        assert await db.get(Thread, tid) is None

    async with AsyncSessionLocal() as db:
        await db.execute(delete(ThreadPost).where(ThreadPost.author_id == stu_id))
        await db.execute(delete(Thread).where(Thread.creator_id == stu_id))
        await db.execute(delete(User).where(User.id.in_([stu_id, tutor_id])))
        await db.execute(delete(Course).where(Course.id == course_id))
        await db.commit()
