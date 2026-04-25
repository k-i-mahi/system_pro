from __future__ import annotations

import logging
from email.message import EmailMessage

import aiosmtplib
import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

_RESET_SUBJECT = "Cognitive Copilot - Password Reset"
_RESET_TEXT = (
    "We received a request to reset your Cognitive Copilot password.\n\n"
    "Click or paste this link to set a new password (expires in 10 minutes):\n"
    "{reset_link}\n\n"
    "If you did not request this, you can safely ignore this email."
)
_RESET_HTML = """
<html>
  <body style="font-family:sans-serif;color:#333;max-width:480px;margin:auto;padding:24px">
    <h2 style="color:#4f46e5">Cognitive Copilot</h2>
    <p>We received a request to reset your password.</p>
    <p>
      <a href="{reset_link}"
         style="display:inline-block;padding:10px 20px;background:#4f46e5;color:#fff;
                border-radius:6px;text-decoration:none;font-weight:600">
        Reset Password
      </a>
    </p>
    <p style="color:#666;font-size:13px">
      This link expires in <strong>10 minutes</strong>.
      If you did not request this, you can safely ignore this email.
    </p>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="color:#999;font-size:12px">
      Or copy-paste this URL into your browser:<br>
      <a href="{reset_link}" style="color:#4f46e5">{reset_link}</a>
    </p>
  </body>
</html>
"""


def _password_reset_content(reset_link: str) -> tuple[str, str]:
    return _RESET_TEXT.format(reset_link=reset_link), _RESET_HTML.format(reset_link=reset_link)


def _build_password_reset_message(to_email: str, reset_link: str) -> EmailMessage:
    text_body, html_body = _password_reset_content(reset_link)

    message = EmailMessage()
    message["From"] = settings.email_from_header
    message["To"] = to_email
    message["Subject"] = _RESET_SUBJECT

    if settings.EMAIL_REPLY_TO and settings.EMAIL_REPLY_TO.strip():
        message["Reply-To"] = settings.EMAIL_REPLY_TO.strip()

    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    return message


async def _send_via_smtp(message: EmailMessage, to_email: str) -> None:
    if not settings.SMTP_HOST or not settings.SMTP_USER or not settings.SMTP_PASS:
        missing = [
            key
            for key, value in {
                "SMTP_HOST": settings.SMTP_HOST,
                "SMTP_USER": settings.SMTP_USER,
                "SMTP_PASS": settings.SMTP_PASS,
            }.items()
            if not value
        ]
        raise RuntimeError(
            f"Email service is not configured ({', '.join(missing)} missing in .env). "
            "Set SMTP credentials once for your app sender account, or switch to "
            "EMAIL_PROVIDER=resend with RESEND_API_KEY and EMAIL_FROM_ADDRESS."
        )

    from_addr = settings.email_from_address

    # Gmail App Passwords are shown with spaces for readability ("xxxx xxxx xxxx xxxx")
    # but SMTP auth requires them without spaces.
    smtp_pass = (settings.SMTP_PASS or "").replace(" ", "")

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=smtp_pass,
            start_tls=settings.SMTP_USE_TLS,
            sender=from_addr,
            recipients=[to_email],
        )
        logger.info("Password reset email sent to %s via SMTP", to_email)
    except Exception as exc:
        logger.error("Failed to send password reset email to %s via SMTP: %s", to_email, exc)
        raise RuntimeError(
            "Could not send the password reset email via SMTP. "
            "Please check your sender credentials or try again later."
        ) from exc


async def _send_via_resend(to_email: str, reset_link: str) -> None:
    if not settings.RESEND_API_KEY:
        raise RuntimeError(
            "Email service is not configured (RESEND_API_KEY missing in .env). "
            "Set EMAIL_PROVIDER=resend, verify your sending domain, and add "
            "RESEND_API_KEY plus EMAIL_FROM_ADDRESS."
        )

    text_body, html_body = _password_reset_content(reset_link)
    payload: dict[str, object] = {
        "from": settings.email_from_header,
        "to": [to_email],
        "subject": _RESET_SUBJECT,
        "text": text_body,
        "html": html_body,
    }

    if settings.EMAIL_REPLY_TO and settings.EMAIL_REPLY_TO.strip():
        payload["reply_to"] = settings.EMAIL_REPLY_TO.strip()

    headers = {
        "Authorization": f"Bearer {settings.RESEND_API_KEY}",
        "Content-Type": "application/json",
        "User-Agent": "cognitive-copilot-backend/1.0",
    }

    try:
        async with httpx.AsyncClient(base_url=settings.resend_base_url, timeout=20.0) as client:
            response = await client.post("/emails", headers=headers, json=payload)
    except httpx.HTTPError as exc:
        logger.error("Failed to send password reset email to %s via Resend: %s", to_email, exc)
        raise RuntimeError(
            "Could not send the password reset email via Resend. "
            "Please check your network connection or try again later."
        ) from exc

    if response.is_success:
        email_id = response.json().get("id")
        logger.info("Password reset email sent to %s via Resend (id=%s)", to_email, email_id)
        return

    try:
        detail = response.json()
    except ValueError:
        detail = response.text

    logger.error(
        "Failed to send password reset email to %s via Resend: status=%s detail=%s",
        to_email,
        response.status_code,
        detail,
    )
    raise RuntimeError(
        "Could not send the password reset email via Resend. "
        "Please verify your sending domain and API key."
    )


async def send_password_reset_email(to_email: str, reset_link: str) -> None:
    provider = settings.email_provider

    if provider == "resend":
        await _send_via_resend(to_email, reset_link)
        return

    if provider == "smtp":
        message = _build_password_reset_message(to_email, reset_link)
        await _send_via_smtp(message, to_email)
        return

    raise RuntimeError(
        f"Unsupported EMAIL_PROVIDER '{settings.EMAIL_PROVIDER}'. "
        "Use 'smtp' or 'resend'."
    )
