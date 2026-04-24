from __future__ import annotations

import logging
import secrets
import re
from urllib.parse import quote

import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import ConflictError, NotFoundError, UnauthorizedError, ValidationError
from app.core.security import (
    decode_token,
    generate_access_token,
    generate_refresh_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.models.enums import Role
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    UserFull,
    UserPublic,
    VerifyOtpRequest,
)
from app.services.email_service import send_password_reset_email

logger = logging.getLogger(__name__)

_RT_TTL = 7 * 24 * 60 * 60   # 7 days in seconds
_AT_TTL = 15 * 60             # 15 minutes
_OTP_TTL = 5 * 60             # 5 minutes
_RESET_TTL = 10 * 60          # 10 minutes
_STUDENT_EMAIL_RE = re.compile(r"^[a-z]+[0-9]+@stud\.kuet\.ac\.bd$")
_TUTOR_EMAIL_RE = re.compile(r"^[a-z]+@[a-z]+\.kuet\.ac\.bd$")


def _email_ok_for_role(email: str, role: Role) -> bool:
    if role == Role.STUDENT:
        return bool(_STUDENT_EMAIL_RE.match(email))
    if role == Role.TUTOR:
        return bool(_TUTOR_EMAIL_RE.match(email))
    return True


async def register(db: AsyncSession, redis: aioredis.Redis, body: RegisterRequest) -> dict:
    result = await db.execute(select(User).where(User.email == body.email))
    if result.scalar_one_or_none():
        raise ConflictError("Account is already registered. Please sign in!")

    user = User(
        university_name=body.universityName,
        name=body.name,
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    access = generate_access_token(user.id)
    refresh = generate_refresh_token(user.id)
    await redis.set(f"rt:{user.id}:{refresh}", "1", ex=_RT_TTL)

    return {"accessToken": access, "refreshToken": refresh, "user": UserPublic.from_orm_user(user).model_dump()}


async def login(db: AsyncSession, redis: aioredis.Redis, body: LoginRequest) -> dict:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user:
        raise UnauthorizedError("Account not registered yet. Please sign up!", code="ACCOUNT_NOT_REGISTERED")

    if not _email_ok_for_role(user.email, user.role):
        raise UnauthorizedError("Email format does not match your registered role", code="INVALID_ROLE_EMAIL")

    if not verify_password(body.password, user.password_hash):
        raise UnauthorizedError("Password incorrect", code="INVALID_PASSWORD")

    access = generate_access_token(user.id)
    refresh = generate_refresh_token(user.id)
    await redis.set(f"rt:{user.id}:{refresh}", "1", ex=_RT_TTL)

    return {"accessToken": access, "refreshToken": refresh, "user": UserPublic.from_orm_user(user).model_dump()}


async def refresh_tokens(redis: aioredis.Redis, body: RefreshRequest) -> dict:
    import jwt

    try:
        payload = decode_token(body.refreshToken)
    except jwt.InvalidTokenError:
        raise UnauthorizedError("Invalid refresh token", code="INVALID_TOKEN")

    if payload.get("type") != "refresh":
        raise UnauthorizedError("Not a refresh token", code="INVALID_TOKEN")

    user_id: str = payload["userId"]
    stored = await redis.get(f"rt:{user_id}:{body.refreshToken}")
    if not stored:
        raise UnauthorizedError("Refresh token expired or revoked", code="INVALID_TOKEN")

    await redis.delete(f"rt:{user_id}:{body.refreshToken}")
    new_access = generate_access_token(user_id)
    new_refresh = generate_refresh_token(user_id)
    await redis.set(f"rt:{user_id}:{new_refresh}", "1", ex=_RT_TTL)

    return {"accessToken": new_access, "refreshToken": new_refresh}


async def logout(redis: aioredis.Redis, access_token: str, user_id: str, refresh_token: str | None) -> None:
    await redis.set(f"bl:{access_token}", "1", ex=_AT_TTL)
    if refresh_token:
        await redis.delete(f"rt:{user_id}:{refresh_token}")


async def forgot_password(db: AsyncSession, redis: aioredis.Redis, body: ForgotPasswordRequest) -> None:
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if not user:
        return  # Don't reveal whether email is registered

    reset_token = secrets.token_urlsafe(32)
    await redis.set(f"reset:{reset_token}", body.email, ex=_RESET_TTL)
    reset_link = f"{settings.FRONTEND_URL}/reset-password?token={quote(reset_token)}"
    try:
        await send_password_reset_email(body.email, reset_link)
    except RuntimeError as exc:
        # Clean up the token so it cannot be used if the email was never delivered.
        await redis.delete(f"reset:{reset_token}")
        raise ValidationError(str(exc)) from exc


async def verify_otp(redis: aioredis.Redis, body: VerifyOtpRequest) -> str:
    stored = await redis.get(f"otp:{body.email}")
    if not stored or stored != body.otp:
        raise ValidationError("Invalid or expired OTP", details=[{"code": "INVALID_OTP"}])

    reset_token = secrets.token_hex(32)
    await redis.set(f"reset:{reset_token}", body.email, ex=_RESET_TTL)
    await redis.delete(f"otp:{body.email}")
    return reset_token


async def reset_password(db: AsyncSession, redis: aioredis.Redis, body: ResetPasswordRequest) -> None:
    email = await redis.get(f"reset:{body.token}")
    if not email:
        raise ValidationError("Reset token is invalid or expired", details=[{"code": "INVALID_TOKEN"}])

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")

    user.password_hash = hash_password(body.newPassword)
    await db.commit()
    await redis.delete(f"reset:{body.token}")


async def get_me(db: AsyncSession, user_id: str) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    return UserFull.from_orm_user(user).model_dump()
