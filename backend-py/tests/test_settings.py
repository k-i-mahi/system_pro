"""Integration tests for /api/settings."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/settings"

_TOKEN: str | None = None


async def _token(client: AsyncClient) -> str:
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    r = await client.post(f"{BASE_AUTH}/login", json={"email": "student@copilot.dev", "password": "Password123"})
    if r.status_code != 200:
        pytest.skip("Seed user not available")
    _TOKEN = r.json()["data"]["accessToken"]
    return _TOKEN


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_get_settings_requires_auth(client: AsyncClient) -> None:
    r = await client.get(BASE + "/")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_settings(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.get(BASE + "/", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "language" in data
    assert "timezone" in data
    assert "timeFormat" in data
    assert "dateFormat" in data


@pytest.mark.asyncio
async def test_update_general(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.patch(
        BASE + "/general",
        json={"language": "en", "timezone": "Asia/Dhaka"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["timezone"] == "Asia/Dhaka"


@pytest.mark.asyncio
async def test_update_password_wrong_current(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.patch(
        BASE + "/password",
        json={"oldPassword": "WrongPass99", "newPassword": "NewPass123"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_update_notifications(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.patch(
        BASE + "/notifications",
        json={"notifChat": False},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["notifChat"] is False
