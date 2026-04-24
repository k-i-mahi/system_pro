from __future__ import annotations

import logging

import aiosmtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger(__name__)


async def send_password_reset_email(to_email: str, reset_link: str) -> None:
    if not settings.SMTP_HOST or not settings.SMTP_USER or not settings.SMTP_PASS:
        missing = [
            k for k, v in {
                "SMTP_HOST": settings.SMTP_HOST,
                "SMTP_USER": settings.SMTP_USER,
                "SMTP_PASS": settings.SMTP_PASS,
            }.items() if not v
        ]
        raise RuntimeError(
            f"Email service is not configured ({', '.join(missing)} missing in .env). "
            "Set SMTP_HOST=smtp.gmail.com, SMTP_USER=<your-gmail>, "
            "SMTP_PASS=<16-char-app-password> to enable password reset emails."
        )

    # Gmail (and most providers) require the From address to match the authenticated SMTP user.
    from_addr = settings.SMTP_USER

    message = EmailMessage()
    message["From"] = from_addr
    message["To"] = to_email
    message["Subject"] = "Cognitive Copilot — Password Reset"

    message.set_content(
        (
            "We received a request to reset your Cognitive Copilot password.\n\n"
            f"Click or paste this link to set a new password (expires in 10 minutes):\n{reset_link}\n\n"
            "If you did not request this, you can safely ignore this email."
        )
    )
    message.add_alternative(
        f"""
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
        """,
        subtype="html",
    )

    try:
        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASS,
            start_tls=settings.SMTP_USE_TLS,
        )
        logger.info("Password reset email sent to %s", to_email)
    except Exception as exc:
        logger.error("Failed to send password reset email to %s: %s", to_email, exc)
        raise RuntimeError(
            "Could not send the password reset email. "
            "Please check your SMTP settings or try again later."
        ) from exc
