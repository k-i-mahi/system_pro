from __future__ import annotations

import logging

import socketio

logger = logging.getLogger(__name__)

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins="*",
    logger=False,
    engineio_logger=False,
)


@sio.event
async def connect(sid: str, environ: dict, auth: dict | None = None) -> bool:
    from app.core.security import decode_token
    import jwt

    token = (auth or {}).get("token", "")
    if not token:
        return False

    try:
        payload = decode_token(token)
        user_id: str | None = payload.get("userId")
        if not user_id or payload.get("type") != "access":
            return False
        await sio.enter_room(sid, f"user:{user_id}")
        await sio.save_session(sid, {"user_id": user_id})
        logger.debug("Socket connected sid=%s user=%s", sid, user_id)

        # Emit current unread count so the header badge syncs immediately.
        try:
            from app.db.session import AsyncSessionLocal
            from app.services.notifications_service import get_visible_unread_count

            async with AsyncSessionLocal() as db:
                count = await get_visible_unread_count(db, user_id)
            await sio.emit("notification:count", {"count": count}, room=f"user:{user_id}")
        except Exception as exc:
            logger.warning("Failed to emit unread count on connect: %s", exc)

        return True
    except jwt.InvalidTokenError:
        return False
    except Exception as exc:
        logger.warning("Socket connect error: %s", exc)
        return False


@sio.event
async def disconnect(sid: str) -> None:
    try:
        session = await sio.get_session(sid)
        logger.debug("Socket disconnected sid=%s user=%s", sid, (session or {}).get("user_id"))
    except Exception:
        pass


async def emit_course_analytics_updated(course_id: str) -> None:
    """Broadcast a course analytics-updated event to all connected clients."""
    try:
        await sio.emit("analytics:course-updated", {"courseId": course_id})
    except Exception as exc:
        logger.warning("Failed to emit analytics update for course %s: %s", course_id, exc)


async def emit_routine_updated(course_id: str) -> None:
    """Notify clients to refetch schedule / my-courses after slots change (e.g. manual Add Course)."""
    try:
        await sio.emit("routine:updated", {"courseId": course_id})
    except Exception as exc:
        logger.warning("Failed to emit routine update for course %s: %s", course_id, exc)


async def emit_community_updated(community_id: str, course_id: str) -> None:
    """Notify clients to refetch classroom detail / lists (e.g. student joined)."""
    try:
        await sio.emit("community:updated", {"communityId": community_id, "courseId": course_id})
    except Exception as exc:
        logger.warning(
            "Failed to emit community update community=%s course=%s: %s",
            community_id,
            course_id,
            exc,
        )
