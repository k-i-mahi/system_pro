"""Thread reply and like notifications (student thread owner, notifChat preference)."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.community import Thread, ThreadLike, ThreadPost
from app.models.course import Course
from app.models.enums import NotificationType, Role
from app.models.misc import Notification
from app.models.user import User
from app.services import community_service


def _email(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}@thread-notif.test"


@pytest.mark.asyncio
async def test_reply_notifies_thread_owner_respects_notif_chat() -> None:
    async with AsyncSessionLocal() as db:
        owner = User(
            name="Owner",
            email=_email("own"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
            notif_chat=True,
        )
        other = User(
            name="Replier",
            email=_email("rep"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add_all([owner, other])
        await db.flush()

        course = Course(course_code=f"T{uuid.uuid4().hex[:6]}", course_name="Co")
        db.add(course)
        await db.flush()

        thread = Thread(title="Q", body="?", course_id=course.id, creator_id=owner.id, tags=[])
        db.add(thread)
        await db.commit()
        tid = thread.id

        try:
            await community_service.create_post(db, tid, other.id, "An answer", None)
            n = (
                await db.execute(select(Notification).where(Notification.user_id == owner.id))
            ).scalars().first()
            assert n is not None
            assert n.type == NotificationType.MESSAGE
            assert n.metadata_.get("kind") == "THREAD_REPLY"
            assert n.metadata_.get("threadId") == tid
            assert "/community/threads/" in (n.metadata_.get("deepLink") or "")

            await db.execute(delete(Notification).where(Notification.user_id == owner.id))
            await db.commit()

            owner.notif_chat = False
            await db.commit()

            await community_service.create_post(db, tid, other.id, "Second reply", None)
            n2 = (
                await db.execute(select(Notification).where(Notification.user_id == owner.id))
            ).scalars().first()
            assert n2 is None
        finally:
            await db.execute(delete(ThreadPost).where(ThreadPost.thread_id == tid))
            await db.execute(delete(Notification).where(Notification.user_id == owner.id))
            await db.execute(delete(Thread).where(Thread.id == tid))
            await db.execute(delete(User).where(User.id.in_([owner.id, other.id])))
            await db.execute(delete(Course).where(Course.id == course.id))
            await db.commit()


@pytest.mark.asyncio
async def test_like_notifies_once_per_liker_no_self_notify() -> None:
    async with AsyncSessionLocal() as db:
        owner = User(
            name="Owner",
            email=_email("own2"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
            notif_chat=True,
        )
        liker = User(
            name="Liker",
            email=_email("lik"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add_all([owner, liker])
        await db.flush()

        thread = Thread(title="Q2", body="?", course_id=None, creator_id=owner.id, tags=[])
        db.add(thread)
        await db.commit()
        tid = thread.id

        try:
            await community_service.like_thread(db, tid, owner.id)
            self_notifs = (
                await db.execute(select(Notification).where(Notification.user_id == owner.id))
            ).scalars().all()
            assert len(self_notifs) == 0

            await community_service.like_thread(db, tid, liker.id)
            rows = (
                await db.execute(select(Notification).where(Notification.user_id == owner.id))
            ).scalars().all()
            assert len(rows) == 1
            assert rows[0].metadata_.get("kind") == "THREAD_LIKE"
            assert rows[0].metadata_.get("notificationKey") == f"thread_like:{tid}:{liker.id}"

            await community_service.like_thread(db, tid, liker.id)
            rows2 = (
                await db.execute(select(Notification).where(Notification.user_id == owner.id))
            ).scalars().all()
            assert len(rows2) == 1
        finally:
            await db.execute(delete(ThreadLike).where(ThreadLike.thread_id == tid))
            await db.execute(delete(Notification).where(Notification.user_id == owner.id))
            await db.execute(delete(Thread).where(Thread.id == tid))
            await db.execute(delete(User).where(User.id.in_([owner.id, liker.id])))
            await db.commit()


@pytest.mark.asyncio
async def test_unlike_does_not_create_notification() -> None:
    async with AsyncSessionLocal() as db:
        owner = User(
            name="Owner",
            email=_email("own3"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
            notif_chat=True,
        )
        liker = User(
            name="Liker",
            email=_email("lik3"),
            university_name="U",
            password_hash=hash_password("Password123"),
            role=Role.STUDENT,
        )
        db.add_all([owner, liker])
        await db.flush()

        thread = Thread(title="Q3", body="?", course_id=None, creator_id=owner.id, tags=[])
        db.add(thread)
        await db.commit()
        tid = thread.id

        try:
            await community_service.like_thread(db, tid, liker.id)
            await db.execute(delete(Notification).where(Notification.user_id == owner.id))
            await db.commit()

            await community_service.unlike_thread(db, tid, liker.id)
            await community_service.like_thread(db, tid, liker.id)
            rows = (
                await db.execute(select(Notification).where(Notification.user_id == owner.id))
            ).scalars().all()
            assert len(rows) == 1
        finally:
            await db.execute(delete(ThreadLike).where(ThreadLike.thread_id == tid))
            await db.execute(delete(Notification).where(Notification.user_id == owner.id))
            await db.execute(delete(Thread).where(Thread.id == tid))
            await db.execute(delete(User).where(User.id.in_([owner.id, liker.id])))
            await db.commit()
