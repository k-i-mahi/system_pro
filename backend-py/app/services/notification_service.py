from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.enums import NotificationType
from app.models.misc import Notification

logger = logging.getLogger(__name__)


async def create_notification(
    db: AsyncSession,
    user_id: str,
    type: NotificationType,
    title: str,
    body: str,
    metadata: dict | None = None,
) -> Notification:
    notif = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        metadata_=metadata,
    )
    db.add(notif)
    await db.flush()

    # Emit real-time events (fire-and-forget — don't let socket errors abort the request)
    try:
        from app.core.socket import sio

        unread_count: int = (
            await db.execute(
                select(func.count()).select_from(Notification).where(
                    Notification.user_id == user_id,
                    Notification.is_read.is_(False),
                )
            )
        ).scalar_one()

        room = f"user:{user_id}"
        await sio.emit(
            "notification:new",
            {
                "id": notif.id,
                "type": notif.type.value if hasattr(notif.type, "value") else notif.type,
                "title": notif.title,
                "body": notif.body,
                "isRead": False,
                "createdAt": notif.created_at.isoformat() if notif.created_at else None,
            },
            room=room,
        )
        await sio.emit("notification:count", {"count": unread_count}, room=room)
    except Exception as exc:
        logger.warning("Socket emit failed: %s", exc)

    return notif
