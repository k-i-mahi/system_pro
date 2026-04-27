from __future__ import annotations

"""Low-level notification persistence and socket fan-out.

Callers are responsible for **role-appropriate targeting** (see also ``notifications_service``,
``notification_worker``, ``community_service``, ``courses_service``):

- **Student-only:** enrollment-based class/lab reminders with ``attendancePrompt``,
  post-class prompts, 11 PM follow-ups, absent alerts, class-response submissions,
  course material prompts from ``_notify_course_students``, marks uploads, classroom
  announcements (recipients are classroom student members only).
- **Tutor / admin (teaching context):** teaching reminders tied to ``CommunityRole.TUTOR``,
  and ``MATERIAL_UPLOAD_PROMPT`` when a student submits a class response for tutors to act on.

This module does not infer roles; it only dedupes on ``notificationKey`` and stores rows.
"""

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
        from app.services.notifications_service import get_visible_unread_count

        unread_count = await get_visible_unread_count(db, user_id, sync_reminders=False)

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
