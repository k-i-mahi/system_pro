from __future__ import annotations

from datetime import datetime, timezone

import bcrypt
import jwt

from app.core.config import settings

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def _make_token(user_id: str, token_type: str, expires_in: int) -> str:
    now = int(datetime.now(timezone.utc).timestamp())
    payload = {"userId": user_id, "type": token_type, "iat": now, "exp": now + expires_in}
    return jwt.encode(payload, settings.AUTH_SECRET, algorithm="HS256")


def generate_access_token(user_id: str) -> str:
    return _make_token(user_id, "access", settings.jwt_access_seconds)


def generate_refresh_token(user_id: str) -> str:
    return _make_token(user_id, "refresh", settings.jwt_refresh_seconds)


def decode_token(token: str) -> dict:
    """Raises jwt.InvalidTokenError on bad/expired tokens."""
    return jwt.decode(token, settings.AUTH_SECRET, algorithms=["HS256"])
