"""Integration tests for /api/ai-tutor/ask-course — requires running DB + seed user when applicable."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/ai-tutor"


async def _student_token(client: AsyncClient) -> str:
    r = await client.post(
        f"{BASE_AUTH}/login",
        json={"email": "student@copilot.dev", "password": "Password123"},
    )
    if r.status_code != 200:
        pytest.skip("Seed user not available — run `npm run db:seed` in backend/")
    return r.json()["data"]["accessToken"]


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_ask_course_requires_auth(client: AsyncClient) -> None:
    r = await client.post(f"{BASE}/ask-course", json={"question": "What is FFT?", "stream": False})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_ask_course_rejects_short_question(client: AsyncClient) -> None:
    token = await _student_token(client)
    r = await client.post(
        f"{BASE}/ask-course",
        headers={"Authorization": f"Bearer {token}"},
        json={"question": "ab", "courseId": "any-id", "stream": False},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_ask_course_rejects_missing_scope(client: AsyncClient) -> None:
    token = await _student_token(client)
    r = await client.post(
        f"{BASE}/ask-course",
        headers={"Authorization": f"Bearer {token}"},
        json={"question": "What is an FFT?", "stream": False},
    )
    assert r.status_code == 400


@pytest.mark.asyncio
async def test_ask_course_unknown_course_not_found(client: AsyncClient) -> None:
    token = await _student_token(client)
    r = await client.post(
        f"{BASE}/ask-course",
        headers={"Authorization": f"Bearer {token}"},
        json={"question": "What is an FFT?", "courseId": "nonexistent-course-id", "stream": False},
    )
    assert r.status_code == 404
