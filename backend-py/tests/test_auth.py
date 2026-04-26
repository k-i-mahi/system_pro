"""Integration tests for /api/auth — runs against the real database."""
from __future__ import annotations

import pytest
import pytest_asyncio
import redis.asyncio as aioredis
from httpx import ASGITransport, AsyncClient

from app.core.config import settings
from main import app

BASE = "/api/auth"


@pytest_asyncio.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.mark.asyncio
async def test_health(client: AsyncClient) -> None:
    r = await client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_register_and_login(client: AsyncClient) -> None:
    payload = {
        "universityName": "Test University",
        "name": "Test User",
        "email": "tester2107001@stud.kuet.ac.bd",
        "password": "Password123",
        "role": "STUDENT",
    }
    r = await client.post(f"{BASE}/register", json=payload)
    # 201 on first call; 409 if already exists from a previous run
    assert r.status_code in (201, 409)

    if r.status_code == 201:
        data = r.json()["data"]
        assert "accessToken" in data
        assert "refreshToken" in data
        assert data["user"]["email"] == payload["email"]

    # Login
    r = await client.post(f"{BASE}/login", json={"email": payload["email"], "password": payload["password"]})
    assert r.status_code == 200
    tokens = r.json()["data"]
    assert "accessToken" in tokens

    # GET /me
    r = await client.get(f"{BASE}/me", headers={"Authorization": f"Bearer {tokens['accessToken']}"})
    assert r.status_code == 200
    assert r.json()["data"]["email"] == payload["email"]


@pytest.mark.asyncio
async def test_register_admin_role_forbidden(client: AsyncClient) -> None:
    """ADMIN self-registration must be blocked at the schema level."""
    payload = {
        "universityName": "Test University",
        "name": "Admin User",
        "email": "pytest_admin2107001@stud.kuet.ac.bd",
        "password": "Password123",
        "role": "ADMIN",
    }
    r = await client.post(f"{BASE}/register", json=payload)
    assert r.status_code == 422
    assert "STUDENT" in str(r.json()) or "TUTOR" in str(r.json()) or "Registration" in str(r.json())


@pytest.mark.asyncio
async def test_login_invalid_credentials(client: AsyncClient) -> None:
    r = await client.post(
        f"{BASE}/login",
        json={"email": "unknown2107001@stud.kuet.ac.bd", "password": "Wrong1234"},
    )
    assert r.status_code == 401
    assert r.json()["success"] is False
    assert r.json()["error"]["message"] == "Account not registered yet. Please sign up!"


@pytest.mark.asyncio
async def test_login_rejects_non_educational_mail(client: AsyncClient) -> None:
    r = await client.post(f"{BASE}/login", json={"email": "random@gmail.com", "password": "Password123"})
    assert r.status_code == 422
    assert "Only verified educational mail is allowed" in str(r.json())


@pytest.mark.asyncio
async def test_register_validation(client: AsyncClient) -> None:
    r = await client.post(f"{BASE}/register", json={"universityName": "x", "name": "x", "email": "bad", "password": "weak"})
    assert r.status_code == 422
    assert r.json()["success"] is False


@pytest.mark.asyncio
async def test_register_student_email_format_restricted(client: AsyncClient) -> None:
    r = await client.post(
        f"{BASE}/register",
        json={
            "universityName": "Khulna University of Engineering and Technology",
            "name": "Student One",
            "email": "student@gmail.com",
            "password": "Password123",
            "role": "STUDENT",
        },
    )
    assert r.status_code == 422
    assert "Only verified educational mail is allowed" in str(r.json())


@pytest.mark.asyncio
async def test_register_tutor_email_format_restricted(client: AsyncClient) -> None:
    r = await client.post(
        f"{BASE}/register",
        json={
            "universityName": "Khulna University of Engineering and Technology",
            "name": "Tutor One",
            "email": "tutor@gmail.com",
            "password": "Password123",
            "role": "TUTOR",
        },
    )
    assert r.status_code == 422
    assert "Only verified educational mail is allowed" in str(r.json())


@pytest.mark.asyncio
async def test_refresh_invalid_token(client: AsyncClient) -> None:
    r = await client.post(f"{BASE}/refresh", json={"refreshToken": "not.a.real.token"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_reset_password_updates_login_password(client: AsyncClient) -> None:
    email = "resetuser2107002@stud.kuet.ac.bd"
    old_password = "Password123"
    new_password = "NewPassword123"

    await client.post(
        f"{BASE}/register",
        json={
            "universityName": "Test University",
            "name": "Reset User",
            "email": email,
            "password": old_password,
            "role": "STUDENT",
        },
    )

    redis = aioredis.from_url(settings.REDIS_URL, decode_responses=True)
    token = "pytest-reset-token"
    await redis.set(f"reset:{token}", email, ex=600)
    await redis.aclose()

    r = await client.post(f"{BASE}/reset-password", json={"token": token, "newPassword": new_password})
    assert r.status_code == 200

    old_login = await client.post(f"{BASE}/login", json={"email": email, "password": old_password})
    assert old_login.status_code == 401
    assert old_login.json()["error"]["message"] == "Password incorrect"

    new_login = await client.post(f"{BASE}/login", json={"email": email, "password": new_password})
    assert new_login.status_code == 200
    assert "accessToken" in new_login.json()["data"]


@pytest.mark.asyncio
async def test_me_unauthorized(client: AsyncClient) -> None:
    r = await client.get(f"{BASE}/me")
    assert r.status_code == 401
