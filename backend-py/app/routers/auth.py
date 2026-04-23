import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import response as resp
from app.core.deps import CurrentUserIdDep, get_current_user_id, get_db, get_redis
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    VerifyOtpRequest,
)
from app.services import auth_service


class LogoutRequest(BaseModel):
    refreshToken: str | None = None

router = APIRouter()


@router.post("/register")
async def register(
    request: Request,
    body: RegisterRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
) -> JSONResponse:
    data = await auth_service.register(db, redis, body)
    return resp.created(data)


@router.post("/login")
async def login(
    request: Request,
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
) -> JSONResponse:
    data = await auth_service.login(db, redis, body)
    return resp.success(data)


@router.post("/refresh")
async def refresh(body: RefreshRequest, redis: aioredis.Redis = Depends(get_redis)) -> JSONResponse:
    data = await auth_service.refresh_tokens(redis, body)
    return resp.success(data)


@router.post("/logout")
async def logout(
    request: Request,
    body: LogoutRequest,
    user_id: str = Depends(get_current_user_id),
    redis=Depends(get_redis),
) -> JSONResponse:
    authorization = request.headers.get("authorization", "")
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    refresh_token = body.refreshToken if body else None
    await auth_service.logout(redis, token, user_id, refresh_token)
    return resp.success({"message": "Logged out"})


@router.post("/forgot-password")
async def forgot_password(
    request: Request,
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
) -> JSONResponse:
    await auth_service.forgot_password(db, redis, body)
    return resp.success({"message": "If the email exists, a reset code has been sent"})


@router.post("/verify-otp")
async def verify_otp(
    request: Request,
    body: VerifyOtpRequest,
    redis: aioredis.Redis = Depends(get_redis),
) -> JSONResponse:
    token = await auth_service.verify_otp(redis, body)
    return resp.success({"token": token})


@router.post("/reset-password")
async def reset_password(
    request: Request,
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    redis: aioredis.Redis = Depends(get_redis),
) -> JSONResponse:
    await auth_service.reset_password(db, redis, body)
    return resp.success({"message": "Password updated successfully"})


@router.get("/me")
async def get_me(user_id: CurrentUserIdDep, db: AsyncSession = Depends(get_db)) -> JSONResponse:
    data = await auth_service.get_me(db, user_id)
    return resp.success(data)
