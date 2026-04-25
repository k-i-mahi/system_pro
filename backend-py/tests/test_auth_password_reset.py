from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse
from uuid import uuid4

import pytest

from app.core.config import settings
from app.core.deps import get_current_user_id
from app.core.exceptions import UnauthorizedError
from app.core.security import (
    generate_access_token,
    generate_refresh_token,
    hash_password,
    verify_password,
)
from app.models.enums import Role
from app.schemas.auth import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    ResetPasswordRequest,
)
from app.services import auth_service


def _student_email(prefix: str) -> str:
    suffix = str(uuid4().int)[:10]
    return f"{prefix}{suffix}@stud.kuet.ac.bd"


class FakeScalarResult:
    def __init__(self, value: object | None) -> None:
        self._value = value

    def scalar_one_or_none(self) -> object | None:
        return self._value


class FakeAsyncSession:
    def __init__(self, users: dict[str, SimpleNamespace]) -> None:
        self.users = users
        self.committed = False

    async def execute(self, statement: Any) -> FakeScalarResult:
        criteria = getattr(statement, "_where_criteria", ())
        if not criteria:
            return FakeScalarResult(None)

        email = getattr(getattr(criteria[0], "right", None), "value", None)
        return FakeScalarResult(self.users.get(email))

    async def commit(self) -> None:
        self.committed = True


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        self.store[key] = value
        return True

    async def delete(self, *keys: str) -> int:
        deleted = 0
        for key in keys:
            if key in self.store:
                del self.store[key]
                deleted += 1
        return deleted

    async def incr(self, key: str) -> int:
        next_value = int(self.store.get(key, "0")) + 1
        self.store[key] = str(next_value)
        return next_value

    async def scan_iter(self, match: str) -> Any:
        prefix = match[:-1] if match.endswith("*") else match
        for key in list(self.store):
            if key.startswith(prefix):
                yield key


def _make_user(email: str, password: str) -> SimpleNamespace:
    return SimpleNamespace(
        id=str(uuid4()),
        name="Test User",
        email=email,
        university_name="Test University",
        password_hash=hash_password(password),
        role=Role.STUDENT,
        avatar_url=None,
        roll_number=None,
        session=None,
        department=None,
    )


@pytest.mark.asyncio
async def test_forgot_password_stores_reset_token_and_builds_frontend_link(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = _student_email("forgotuser")
    db = FakeAsyncSession({email: _make_user(email, "Password123")})
    redis = FakeRedis()
    captured: dict[str, str] = {}

    async def fake_send_password_reset_email(to_email: str, reset_link: str) -> None:
        captured["to_email"] = to_email
        captured["reset_link"] = reset_link

    monkeypatch.setattr("app.services.auth_service.send_password_reset_email", fake_send_password_reset_email)

    await auth_service.forgot_password(db, redis, ForgotPasswordRequest(email=email))

    assert captured["to_email"] == email
    assert captured["reset_link"].startswith(f"{settings.FRONTEND_URL.rstrip('/')}/reset-password?token=")

    parsed = urlparse(captured["reset_link"])
    token = unquote(parse_qs(parsed.query)["token"][0])
    assert await redis.get(f"reset:{token}") == email


@pytest.mark.asyncio
async def test_reset_password_updates_hash_and_revokes_existing_tokens() -> None:
    email = _student_email("resetuser")
    old_password = "Password123"
    new_password = "NewPassword123"
    user = _make_user(email, old_password)
    db = FakeAsyncSession({email: user})
    redis = FakeRedis()
    old_access_token = generate_access_token(user.id)
    old_refresh_token = generate_refresh_token(user.id)
    reset_token = f"pytest-reset-token-{uuid4().hex}"

    await redis.set(f"rt:{user.id}:{old_refresh_token}", "1", ex=600)
    await redis.set(f"reset:{reset_token}", email, ex=600)

    await auth_service.reset_password(
        db,
        redis,
        ResetPasswordRequest(token=reset_token, newPassword=new_password),
    )

    assert db.committed is True
    assert verify_password(new_password, user.password_hash)
    assert not verify_password(old_password, user.password_hash)
    assert await redis.get(f"reset:{reset_token}") is None
    assert await redis.get(f"authv:{user.id}") == "1"

    with pytest.raises(UnauthorizedError, match="Token revoked"):
        await get_current_user_id(authorization=f"Bearer {old_access_token}", redis=redis)

    with pytest.raises(UnauthorizedError, match="Refresh token expired or revoked"):
        await auth_service.refresh_tokens(redis, RefreshRequest(refreshToken=old_refresh_token))

    login_data = await auth_service.login(db, redis, LoginRequest(email=email, password=new_password))
    assert login_data["user"]["email"] == email

    current_user_id = await get_current_user_id(
        authorization=f"Bearer {login_data['accessToken']}",
        redis=redis,
    )
    assert current_user_id == user.id
