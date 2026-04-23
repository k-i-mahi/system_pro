from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.misc import Notification


def _serialize(n: Notification) -> dict:
    return {
        "id": n.id,
        "userId": n.user_id,
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "isRead": n.is_read,
        "createdAt": n.created_at,
        "metadata": n.metadata_,
    }


async def list_notifications(db: AsyncSession, user_id: str, page: int, limit: int) -> tuple[list[dict], int]:
    offset = (page - 1) * limit
    rows = (await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .offset(offset)
        .limit(limit)
    )).scalars().all()
    total = (await db.execute(
        select(func.count()).select_from(Notification).where(Notification.user_id == user_id)
    )).scalar_one()
    return [_serialize(n) for n in rows], total


async def mark_read(db: AsyncSession, notif_id: str, user_id: str) -> dict:
    n = (await db.execute(
        select(Notification).where(Notification.id == notif_id, Notification.user_id == user_id)
    )).scalar_one_or_none()
    if not n:
        raise NotFoundError("Notification not found")
    n.is_read = True
    await db.commit()
    return {"message": "Marked as read"}


async def mark_all_read(db: AsyncSession, user_id: str) -> dict:
    rows = (await db.execute(
        select(Notification).where(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
    )).scalars().all()
    for n in rows:
        n.is_read = True
    await db.commit()
    return {"message": "All marked as read"}


async def delete_notification(db: AsyncSession, notif_id: str, user_id: str) -> dict:
    n = (await db.execute(
        select(Notification).where(Notification.id == notif_id, Notification.user_id == user_id)
    )).scalar_one_or_none()
    if not n:
        raise NotFoundError("Notification not found")
    await db.delete(n)
    await db.commit()
    return {"message": "Notification deleted"}


async def get_unread_count(db: AsyncSession, user_id: str) -> dict:
    count = (await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.user_id == user_id, Notification.is_read == False  # noqa: E712
        )
    )).scalar_one()
    return {"count": count}
