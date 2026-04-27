"""Class response endpoint is student-only."""
from __future__ import annotations

import random
import string
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from main import app

BASE_AUTH = "/api/auth"
BASE = "/api/notifications"


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _tutor_token(client: AsyncClient) -> str:
    local = "t" + "".join(random.choices(string.ascii_lowercase, k=14))
    email = f"{local}@cse.kuet.ac.bd"
    password = "Password123"
    reg = await client.post(
        f"{BASE_AUTH}/register",
        json={
            "universityName": "Test University",
            "name": "Class Response Tutor",
            "email": email,
            "password": password,
            "role": "TUTOR",
        },
    )
    if reg.status_code not in (200, 201):
        pytest.skip("Could not register tutor")
    login = await client.post(f"{BASE_AUTH}/login", json={"email": email, "password": password})
    if login.status_code != 200:
        pytest.skip("Could not log in tutor")
    return login.json()["data"]["accessToken"]


@pytest.mark.asyncio
async def test_submit_class_response_forbidden_for_tutor(client: AsyncClient) -> None:
    token = await _tutor_token(client)
    r = await client.post(
        f"{BASE}/class-response",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "notificationId": str(uuid.uuid4()),
            "topicCovered": "Topic covered text",
            "materialNeeded": False,
        },
    )
    assert r.status_code == 403
