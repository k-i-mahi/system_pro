from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

import jwt
import redis.asyncio as aioredis
from fastapi import Depends, Header
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.core.security import decode_token
from app.db.session import AsyncSessionLocal
from app.models.enums import Role

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

# ── Auth ──────────────────────────────────────────────────────────────────────

async def get_current_user_id(
    authorization: Annotated[str | None, Header()] = None,
    redis: aioredis.Redis = Depends(get_redis),
) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise UnauthorizedError("Missing token")

    token = authorization[7:]

    blacklisted = await redis.get(f"bl:{token}")
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
    current_auth_version = await redis.get(f"authv:{user_id}")

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
