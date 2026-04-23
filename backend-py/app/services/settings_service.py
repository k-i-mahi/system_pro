from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError
from app.core.security import hash_password, verify_password
from app.models.user import User


async def get_settings(db: AsyncSession, user_id: str) -> dict:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    return {
        "language": user.language,
        "timezone": user.timezone,
        "timeFormat": user.time_format,
        "dateFormat": user.date_format,
        "notifChat": user.notif_chat,
        "notifNewestUpdate": user.notif_newest_update,
        "notifMentorOfMonth": user.notif_mentor_of_month,
        "notifCourseOfMonth": user.notif_course_of_month,
    }


async def update_general(db: AsyncSession, user_id: str, data: dict) -> dict:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    field_map = {"language": "language", "timezone": "timezone", "timeFormat": "time_format", "dateFormat": "date_format"}
    for key, attr in field_map.items():
        if key in data and data[key] is not None:
            setattr(user, attr, data[key])
    await db.commit()
    return {
        "language": user.language,
        "timezone": user.timezone,
        "timeFormat": user.time_format,
        "dateFormat": user.date_format,
    }


async def update_password(db: AsyncSession, user_id: str, old_password: str, new_password: str) -> dict:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    if not verify_password(old_password, user.password_hash):
        raise ValidationError("Current password is incorrect", code="INVALID_PASSWORD")
    if old_password == new_password:
        raise ValidationError("New password must differ from current", code="SAME_PASSWORD")
    user.password_hash = hash_password(new_password)
    await db.commit()
    return {"message": "Password updated"}


async def update_notifications(db: AsyncSession, user_id: str, data: dict) -> dict:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    field_map = {
        "notifChat": "notif_chat",
        "notifNewestUpdate": "notif_newest_update",
        "notifMentorOfMonth": "notif_mentor_of_month",
        "notifCourseOfMonth": "notif_course_of_month",
    }
    for key, attr in field_map.items():
        if key in data and data[key] is not None:
            setattr(user, attr, data[key])
    await db.commit()
    return {
        "notifChat": user.notif_chat,
        "notifNewestUpdate": user.notif_newest_update,
        "notifMentorOfMonth": user.notif_mentor_of_month,
        "notifCourseOfMonth": user.notif_course_of_month,
    }
