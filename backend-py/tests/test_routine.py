"""Integration tests for /api/routine."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/routine"

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
async def test_get_schedule_requires_auth(client: AsyncClient) -> None:
    r = await client.get(BASE + "/")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_schedule(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.get(BASE + "/", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["success"] is True
    assert isinstance(r.json()["data"], list)


@pytest.mark.asyncio
async def test_bulk_create_courses(client: AsyncClient) -> None:
    token = await _token(client)
    payload = {
        "courses": [
            {
                "courseCode": "TST9999",
                "courseName": "Test Course",
                "slots": [
                    {"dayOfWeek": "MON", "startTime": "09:00", "endTime": "10:30", "type": "CLASS"},
                ],
            }
        ]
    }
    r = await client.post(f"{BASE}/courses", json=payload, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 201
    assert r.json()["data"][0]["courseCode"] == "TST9999"


@pytest.mark.asyncio
async def test_update_slot_not_found(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.put(
        f"{BASE}/slots/nonexistent",
        json={"dayOfWeek": "TUE"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_scan_unsupported_type(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.post(
        f"{BASE}/scan",
        files={"file": ("test.exe", b"bad", "application/octet-stream")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (400, 422)
