"""RBAC tests for community routes.

Tests that:
- Students cannot create communities
- Students cannot delete announcements
- Students cannot remove members
- Unauthenticated users are rejected
- Thread APIs are STUDENT-only (tutors/admins get 403)
"""
from __future__ import annotations

import random
import string

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/community"

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


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_list_communities_requires_auth(client: AsyncClient) -> None:
    r = await client.get(f"{BASE}/")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_student_cannot_create_community(client: AsyncClient) -> None:
    token = await _student_token(client)
    r = await client.post(
        f"{BASE}/",
        json={
            "name": "Rogue Community",
            "courseCode": "CSE9999",
            "session": "2025-26",
            "department": "CSE",
            "university": "Test University",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_student_cannot_delete_announcement(client: AsyncClient) -> None:
    """Attempt to delete a nonexistent announcement — should get 403 not 404."""
    token = await _student_token(client)
    r = await client.delete(
        f"{BASE}/fake-community-id/announcements/fake-ann-id",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_student_cannot_remove_member(client: AsyncClient) -> None:
    token = await _student_token(client)
    r = await client.delete(
        f"{BASE}/fake-community-id/members/some-user-id",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_tutor_cannot_access_threads(client: AsyncClient) -> None:
    """Public thread forum is for students only."""
    local = "t" + "".join(random.choices(string.ascii_lowercase, k=14))
    email = f"{local}@cse.kuet.ac.bd"
    password = "Password123"
    reg = await client.post(
        f"{BASE_AUTH}/register",
        json={
            "universityName": "Test University",
            "name": "Tutor Threads RBAC",
            "email": email,
            "password": password,
            "role": "TUTOR",
        },
    )
    if reg.status_code not in (200, 201):
        pytest.skip("Could not register tutor for thread RBAC test")
    login = await client.post(
        f"{BASE_AUTH}/login",
        json={"email": email, "password": password},
    )
    if login.status_code != 200:
        pytest.skip("Could not log in tutor for thread RBAC test")
    token = login.json()["data"]["accessToken"]
    r = await client.get(f"{BASE}/threads", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
