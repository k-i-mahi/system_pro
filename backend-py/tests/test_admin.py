"""Integration tests for /api/admin."""
from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.core.exceptions import ValidationError
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.enums import Role
from app.models.user import User
from app.services import admin_service
from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/admin"


async def _student_token(client: AsyncClient) -> str:
    r = await client.post(f"{BASE_AUTH}/login", json={"email": "student@copilot.dev", "password": "Password123"})
    if r.status_code != 200:
        pytest.skip("Seed user not available")
    return r.json()["data"]["accessToken"]


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_admin_users_requires_admin_role(client: AsyncClient) -> None:
    token = await _student_token(client)
    r = await client.get(f"{BASE}/users", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_cannot_delete_last_admin_account(monkeypatch: pytest.MonkeyPatch) -> None:
    async with AsyncSessionLocal() as db:
        email = f"sole-admin-{uuid.uuid4().hex[:8]}@last-admin.test"
        admin = User(
            name="Sole Admin",
            email=email,
            university_name="University",
            password_hash=hash_password("Password123"),
            role=Role.ADMIN,
        )
        db.add(admin)
        await db.commit()
        admin_id = admin.id

    async def _one_admin(_db: object) -> int:
        return 1

    monkeypatch.setattr(admin_service, "_count_admins", _one_admin)

    async with AsyncSessionLocal() as db:
        with pytest.raises(ValidationError, match="last admin"):
            await admin_service.delete_user(db, admin_id, reason="n/a")

    async with AsyncSessionLocal() as db:
        await db.delete(await db.get(User, admin_id))
        await db.commit()
