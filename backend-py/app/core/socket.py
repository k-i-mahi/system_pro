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
