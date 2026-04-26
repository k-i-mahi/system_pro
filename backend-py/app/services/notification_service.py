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
) -> Notification | None:
    """
    Create a notification with optional idempotency via `notificationKey` in metadata.
    Returns None (and does nothing) if a duplicate key already exists for this user.
    Socket events are emitted after flush so the notification has an ID.
    """
    if key := (metadata or {}).get("notificationKey"):
        exists = (
            await db.execute(
                select(Notification.id).where(
                    Notification.user_id == user_id,
                    Notification.metadata_["notificationKey"].as_string() == key,
                )
            )
        ).scalar_one_or_none()
        if exists:
            return None  # idempotent skip

    notif = Notification(
        user_id=user_id,
        type=type,
        title=title,
        body=body,
        metadata_=metadata,
    )
    db.add(notif)
    await db.flush()

    # Emit real-time events after flush (db.commit() happens in the caller).
    # Fire-and-forget — don't let socket errors abort the request.
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
                "userId": user_id,
                "type": notif.type.value if hasattr(notif.type, "value") else notif.type,
                "title": notif.title,
                "body": notif.body,
                "isRead": False,
                "metadata": notif.metadata_,
                "createdAt": notif.created_at.isoformat() if notif.created_at else None,
            },
            room=room,
        )
        await sio.emit("notification:count", {"count": unread_count}, room=room)
    except Exception as exc:
        logger.warning("Socket emit failed: %s", exc)

    return notif
