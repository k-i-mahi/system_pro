"""Integration tests for /api/auth — runs against the real database."""
from __future__ import annotations

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

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
        "email": "pytest_auth@test.invalid",
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
async def test_login_invalid_credentials(client: AsyncClient) -> None:
    r = await client.post(f"{BASE}/login", json={"email": "nobody@test.invalid", "password": "Wrong1234"})
    assert r.status_code == 401
    assert r.json()["success"] is False


@pytest.mark.asyncio
async def test_register_validation(client: AsyncClient) -> None:
    r = await client.post(f"{BASE}/register", json={"universityName": "x", "name": "x", "email": "bad", "password": "weak"})
    assert r.status_code == 422
    assert r.json()["success"] is False


@pytest.mark.asyncio
async def test_refresh_invalid_token(client: AsyncClient) -> None:
    r = await client.post(f"{BASE}/refresh", json={"refreshToken": "not.a.real.token"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_unauthorized(client: AsyncClient) -> None:
    r = await client.get(f"{BASE}/me")
    assert r.status_code == 401
