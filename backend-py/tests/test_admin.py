"""Integration tests for /api/admin."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

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
