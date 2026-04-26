"""Integration tests for /api/google-classroom."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/google-classroom"

_STUDENT_TOKEN: str | None = None
_TUTOR_TOKEN: str | None = None


async def _student_token(client: AsyncClient) -> str:
    global _STUDENT_TOKEN
    if _STUDENT_TOKEN:
        return _STUDENT_TOKEN
    r = await client.post(
        f"{BASE_AUTH}/login",
        json={"email": "student@copilot.dev", "password": "Password123"},
    )
    if r.status_code != 200:
        pytest.skip("Student seed user not available")
    _STUDENT_TOKEN = r.json()["data"]["accessToken"]
    return _STUDENT_TOKEN


async def _tutor_token(client: AsyncClient) -> str:
    global _TUTOR_TOKEN
    if _TUTOR_TOKEN:
        return _TUTOR_TOKEN

    email = "pytestgoogleteacher@cse.kuet.ac.bd"
    password = "Password123"
    await client.post(
        f"{BASE_AUTH}/register",
        json={
            "universityName": "Khulna University of Engineering and Technology",
            "name": "Google Tutor",
            "email": email,
            "password": password,
            "role": "TUTOR",
        },
    )
    r = await client.post(f"{BASE_AUTH}/login", json={"email": email, "password": password})
    if r.status_code != 200:
        pytest.skip("Tutor account could not be created for Google Classroom RBAC test")
    _TUTOR_TOKEN = r.json()["data"]["accessToken"]
    return _TUTOR_TOKEN


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_student_can_check_google_status(client: AsyncClient) -> None:
    token = await _student_token(client)
    r = await client.get(f"{BASE}/status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "connected" in data


@pytest.mark.asyncio
async def test_tutor_cannot_check_google_status(client: AsyncClient) -> None:
    token = await _tutor_token(client)
    r = await client.get(f"{BASE}/status", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
