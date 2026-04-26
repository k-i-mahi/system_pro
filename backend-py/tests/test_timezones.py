from __future__ import annotations

from datetime import datetime, timezone

from app.core.timezones import zone_from_iana_name


def test_zone_from_iana_name_utc_never_breaks() -> None:
    """Windows without IANA data used to break ZoneInfo('UTC') and crash course load."""
    tz = zone_from_iana_name("UTC")
    now = datetime.now(timezone.utc)
    now.astimezone(tz)
