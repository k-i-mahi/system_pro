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
async def test_delete_course_not_in_plan_returns_404(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.delete(
        f"{BASE}/courses/00000000-0000-0000-0000-000000000001",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_delete_course_removes_from_schedule(client: AsyncClient) -> None:
    token = await _token(client)
    code = "TST8888"
    create = await client.post(
        f"{BASE}/courses",
        json={
            "courses": [
                {
                    "courseCode": code,
                    "courseName": "Delete Me Course",
                    "slots": [{"dayOfWeek": "TUE", "startTime": "10:00", "endTime": "11:00", "type": "CLASS"}],
                }
            ]
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert create.status_code == 201
    course_id = create.json()["data"][0]["id"]

    sched_before = await client.get(f"{BASE}/", headers={"Authorization": f"Bearer {token}"})
    assert sched_before.status_code == 200
    assert any(s.get("courseId") == course_id for s in sched_before.json()["data"])

    del_r = await client.delete(f"{BASE}/courses/{course_id}", headers={"Authorization": f"Bearer {token}"})
    assert del_r.status_code == 200

    sched_after = await client.get(f"{BASE}/", headers={"Authorization": f"Bearer {token}"})
    assert sched_after.status_code == 200
    assert not any(s.get("courseId") == course_id for s in sched_after.json()["data"])


@pytest.mark.asyncio
async def test_scan_unsupported_type(client: AsyncClient) -> None:
    token = await _token(client)
    r = await client.post(
        f"{BASE}/scan",
        files={"file": ("test.exe", b"bad", "application/octet-stream")},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code in (400, 422)
