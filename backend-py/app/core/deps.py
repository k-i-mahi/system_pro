from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Annotated

import jwt
import redis.asyncio as aioredis
import redis.exceptions as redis_exc
from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ForbiddenError, ServiceUnavailableError, UnauthorizedError
from app.core.security import decode_token
from app.db.session import AsyncSessionLocal
from app.models.enums import Role

logger = logging.getLogger(__name__)
_redis_auth_warned = False

# ── Database ──────────────────────────────────────────────────────────────────

async def get_db() -> AsyncSession:  # type: ignore[return]
    async with AsyncSessionLocal() as session:
        yield session


DBDep = Annotated[AsyncSession, Depends(get_db)]

# ── Redis ─────────────────────────────────────────────────────────────────────

async def get_redis() -> aioredis.Redis:
    # Avoid cross-event-loop reuse during tests on Windows by creating
    # a client bound to the current loop for each request.
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


RedisDep = Annotated[aioredis.Redis, Depends(get_redis)]


async def _redis_get_for_auth(redis: aioredis.Redis, key: str) -> str | None:
    """
    Token blacklist and auth-version reads. In production Redis must be up.
    In non-production, fail open so local dev works without Redis (log once).
    """
    global _redis_auth_warned
    try:
        return await redis.get(key)
    except (redis_exc.ConnectionError, redis_exc.TimeoutError, OSError) as exc:
        if settings.NODE_ENV == "production":
            logger.exception("Redis required for auth checks: %s", exc)
            raise ServiceUnavailableError(
                "Authentication dependency unavailable. Ensure Redis is running."
            ) from exc
        if not _redis_auth_warned:
            _redis_auth_warned = True
            logger.warning(
                "Redis unreachable (%s); skipping token blacklist/auth-version checks. "
                "Start Redis (port 6379) for revocation and multi-device security.",
                exc,
            )
        return None


# ── Auth ──────────────────────────────────────────────────────────────────────

async def get_current_user_id(
    authorization: Annotated[str | None, Header()] = None,
    redis: aioredis.Redis = Depends(get_redis),
) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise UnauthorizedError("Missing token")

    token = authorization[7:]

    blacklisted = await _redis_get_for_auth(redis, f"bl:{token}")
    if blacklisted:
        raise UnauthorizedError("Token revoked")

    try:
        payload = decode_token(token)
    except jwt.InvalidTokenError:
        raise UnauthorizedError("Invalid or expired token")

    if payload.get("type") != "access":
        raise UnauthorizedError("Invalid token type")

    user_id = payload["userId"]
    token_auth_version = int(payload.get("authVersion", 0))
    current_auth_version = await _redis_get_for_auth(redis, f"authv:{user_id}")

    if current_auth_version is not None and token_auth_version != int(current_auth_version):
        raise UnauthorizedError("Token revoked")

    return user_id


CurrentUserIdDep = Annotated[str, Depends(get_current_user_id)]


async def get_current_user(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Return the full User ORM object. 401 if the account has been deleted."""
    from app.models.user import User
    user = await db.get(User, user_id)
    if not user:
        raise UnauthorizedError("User account not found or has been deleted")
    return user


if TYPE_CHECKING:
    from app.models.user import User as _User
CurrentUserDep = Annotated["_User", Depends(get_current_user)]


def require_role(*roles: Role):
    """Returns a FastAPI dependency that enforces RBAC."""
    async def _check(
        user_id: str = Depends(get_current_user_id),
        db: AsyncSession = Depends(get_db),
    ) -> str:
        from sqlalchemy import select
        from app.models.user import User

        result = await db.execute(select(User.role).where(User.id == user_id))
        role = result.scalar_one_or_none()
        if role is None:
            raise UnauthorizedError("User not found")
        if role not in roles:
            raise ForbiddenError()
        return user_id

    return Depends(_check)
