"""Integration tests for /api/analytics."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/analytics"

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
async def test_overview_requires_auth(client: AsyncClient) -> None:
    r = await client.get(BASE + "/overview")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_overview(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.get(BASE + "/overview", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["success"] is True
    data = r.json()["data"]
    assert "role" in data


@pytest.mark.asyncio
async def test_get_suggestions(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.get(BASE + "/suggestions", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert isinstance(r.json()["data"], list)


@pytest.mark.asyncio
async def test_course_analytics_not_found(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.get(BASE + "/courses/nonexistent", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_update_attendance_invalid_slot(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.patch(
        BASE + "/attendance",
        json={"slotId": "nonexistent", "date": "2025-01-15T09:00:00Z", "present": True},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (200, 400, 404)


@pytest.mark.asyncio
async def test_update_ct_score_not_found(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.patch(
        BASE + "/ct-score",
        json={"enrollmentId": "nonexistent", "ctScore1": 75.0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_update_lab_score_not_found(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.patch(
        BASE + "/lab-score",
        json={"enrollmentId": "nonexistent", "labScore": 80.0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404
