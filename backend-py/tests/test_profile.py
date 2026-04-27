"""Integration tests for /api/profile."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/profile"

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
async def test_get_profile_requires_auth(client: AsyncClient) -> None:
    r = await client.get(BASE)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_profile(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.get(BASE, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "id" in data
    assert "email" in data
    assert "role" in data


@pytest.mark.asyncio
async def test_update_profile(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.patch(
        BASE,
        json={"bio": "Test bio from pytest"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    assert r.json()["data"]["bio"] == "Test bio from pytest"


@pytest.mark.asyncio
async def test_upload_avatar_invalid_type(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.post(
        BASE + "/avatar",
        files={"avatar": ("test.exe", b"binary", "application/octet-stream")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
