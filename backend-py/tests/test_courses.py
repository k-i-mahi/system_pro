"""Integration tests for /api/courses — requires running DB + a seeded enrollment."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/courses"

_TOKEN: str | None = None
_COURSE_ID: str | None = None


async def _get_token(client: AsyncClient) -> str:
    global _TOKEN
    if _TOKEN:
        return _TOKEN
    r = await client.post(f"{BASE_AUTH}/login", json={"email": "student@copilot.dev", "password": "Password123"})
    if r.status_code != 200:
        pytest.skip("Seed user not available — run `npm run db:seed` in backend/")
    _TOKEN = r.json()["data"]["accessToken"]
    return _TOKEN


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_list_courses(client: AsyncClient) -> None:
    token = await _get_token(client)
    r = await client.get(BASE, headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    assert "data" in body
    assert "meta" in body
    assert "total" in body["meta"]


@pytest.mark.asyncio
async def test_list_courses_pagination(client: AsyncClient) -> None:
    token = await _get_token(client)
    r = await client.get(f"{BASE}?page=1&limit=2", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert len(r.json()["data"]) <= 2


@pytest.mark.asyncio
async def test_list_courses_requires_auth(client: AsyncClient) -> None:
    r = await client.get(BASE)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_my_courses(client: AsyncClient) -> None:
    token = await _get_token(client)
    r = await client.get(f"{BASE}/my-courses", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["success"] is True


@pytest.mark.asyncio
async def test_get_course_detail_not_found(client: AsyncClient) -> None:
    token = await _get_token(client)
    r = await client.get(f"{BASE}/nonexistent-id", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 404
    assert r.json()["success"] is False


@pytest.mark.asyncio
async def test_student_create_topic_is_personal(client: AsyncClient) -> None:
    """Enrolled students may create topics; API stores them as personal (not shared schedule)."""
    token = await _get_token(client)
    r = await client.get(f"{BASE}/my-courses", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        pytest.skip("my-courses unavailable")
    data = r.json().get("data") or []
    if not data:
        pytest.skip("No enrolled courses for seed student")
    course_id = data[0]["id"]
    r2 = await client.post(
        f"{BASE}/{course_id}/topics",
        headers={"Authorization": f"Bearer {token}"},
        json={"title": "Student personal note", "status": "IN_PROGRESS"},
    )
    assert r2.status_code == 201
    body = r2.json().get("data") or {}
    assert body.get("isPersonal") is True
