"""Integration tests for /api/notifications."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/notifications"

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
async def test_list_requires_auth(client: AsyncClient) -> None:
    r = await client.get(BASE + "/")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_notifications(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.get(BASE + "/", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["success"] is True
    assert isinstance(r.json()["data"], list)


@pytest.mark.asyncio
async def test_unread_count(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.get(BASE + "/unread-count", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert "count" in r.json()["data"]


@pytest.mark.asyncio
async def test_mark_all_read(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.patch(BASE + "/read-all", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_mark_read_not_found(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.patch(BASE + "/nonexistent/read", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_not_found(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.delete(BASE + "/nonexistent", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_submit_class_response_not_found(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.post(
        BASE + "/class-response",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "notificationId": "nonexistent",
            "topicCovered": "Complexity analysis",
            "materialNeeded": True,
            "materialRequest": "Need practice sheet",
        },
    )
    assert r.status_code == 404
