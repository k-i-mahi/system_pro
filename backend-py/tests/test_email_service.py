from __future__ import annotations

import pytest

from app.core.config import settings
from app.services import email_service


def _set_email_config(monkeypatch: pytest.MonkeyPatch, **overrides: object) -> None:
    defaults = {
        "EMAIL_PROVIDER": "smtp",
        "EMAIL_FROM_NAME": "Cognitive Copilot",
        "EMAIL_FROM_ADDRESS": "noreply@example.com",
        "EMAIL_REPLY_TO": "support@example.com",
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": 587,
        "SMTP_USER": "mailer@example.com",
        "SMTP_PASS": "secret",
        "SMTP_FROM": None,
        "SMTP_USE_TLS": True,
        "RESEND_API_KEY": "re_test_key",
        "RESEND_BASE_URL": "https://api.resend.com",
    }
    defaults.update(overrides)

    for name, value in defaults.items():
        monkeypatch.setattr(settings, name, value)


@pytest.mark.asyncio
async def test_send_password_reset_email_uses_resend_transport(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_email_config(monkeypatch, EMAIL_PROVIDER="resend")
    captured: dict[str, object] = {}

    class FakeResponse:
        is_success = True
        status_code = 200
        text = ""

        def json(self) -> dict[str, str]:
            return {"id": "email_123"}

    class FakeAsyncClient:
        def __init__(self, *, base_url: str, timeout: float) -> None:
            captured["base_url"] = base_url
            captured["timeout"] = timeout

        async def __aenter__(self) -> "FakeAsyncClient":
            return self

        async def __aexit__(self, exc_type, exc, tb) -> None:
            return None

        async def post(self, path: str, headers: dict[str, str], json: dict[str, object]) -> FakeResponse:
            captured["path"] = path
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr(email_service.httpx, "AsyncClient", FakeAsyncClient)

    await email_service.send_password_reset_email("user@example.com", "https://app.test/reset?token=abc")

    assert captured["base_url"] == "https://api.resend.com"
    assert captured["path"] == "/emails"
    assert captured["headers"]["Authorization"] == "Bearer re_test_key"
    assert captured["headers"]["User-Agent"] == "cognitive-copilot-backend/1.0"
    assert captured["json"]["from"] == "Cognitive Copilot <noreply@example.com>"
    assert captured["json"]["to"] == ["user@example.com"]
    assert captured["json"]["reply_to"] == "support@example.com"


@pytest.mark.asyncio
async def test_send_password_reset_email_uses_configured_sender_for_smtp(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _set_email_config(monkeypatch, EMAIL_PROVIDER="smtp")
    captured: dict[str, object] = {}

    async def fake_send(message, **kwargs):
        captured["message"] = message
        captured["kwargs"] = kwargs

    monkeypatch.setattr(email_service.aiosmtplib, "send", fake_send)

    await email_service.send_password_reset_email("user@example.com", "https://app.test/reset?token=abc")

    message = captured["message"]
    kwargs = captured["kwargs"]

    assert message["From"] == "Cognitive Copilot <noreply@example.com>"
    assert message["To"] == "user@example.com"
    assert message["Reply-To"] == "support@example.com"
    assert kwargs["sender"] == "noreply@example.com"
    assert kwargs["hostname"] == "smtp.example.com"
    assert kwargs["username"] == "mailer@example.com"
