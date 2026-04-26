from __future__ import annotations

from datetime import tzinfo, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models.user import User

__all__ = ["user_timezone", "zone_from_iana_name"]


def zone_from_iana_name(name: str | None) -> tzinfo:
    """Resolve an IANA zone name, or fall back to fixed UTC. Never raises (Windows / minimal tz data)."""
    raw = (name or "UTC").strip() or "UTC"
    try:
        return ZoneInfo(raw)
    except ZoneInfoNotFoundError:
        if raw.upper() in ("UTC", "GMT", "Z"):
            return timezone.utc
    try:
        return ZoneInfo("Etc/UTC")
    except ZoneInfoNotFoundError:
        return timezone.utc


def user_timezone(user: User | None) -> tzinfo:
    """Timezone for a user (profile field) or offset-native UTC if user is None."""
    if user is None:
        return zone_from_iana_name("UTC")
    return zone_from_iana_name(getattr(user, "timezone", None))
