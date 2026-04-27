"""Inspect attendance / notifications for CSE3219 slots."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import create_async_engine

_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / ".env")

SLOTS = (
    "d6ebbb50-6530-4e9f-b0de-abc1ec85e478",
    "64b9bddc-499a-4d10-b438-5319fdd675c4",
    "73bf70ea-f7dd-4e39-ab9c-1f2313b2d406",
)


def _async_url() -> str:
    url = os.environ["DATABASE_URL"]
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    eng = create_async_engine(_async_url())
    in_slots = bindparam("slot_ids", expanding=True)
    async with eng.connect() as c:
        r = await c.execute(
            text(
                """
                SELECT ar."userId", ar."slotId", ar.date, ar.present, u.email
                FROM "AttendanceRecord" ar
                JOIN "User" u ON u.id = ar."userId"
                WHERE ar."slotId" IN :slot_ids
                ORDER BY ar.date DESC, u.email
                LIMIT 200
                """
            ).bindparams(in_slots),
            {"slot_ids": list(SLOTS)},
        )
        print("ATTENDANCE", [dict(x) for x in r.mappings().all()])

        r2 = await c.execute(
            text(
                """
                SELECT id, "userId", type, metadata, "createdAt"
                FROM "Notification"
                WHERE metadata->>'slotId' IN :slot_ids
                ORDER BY "createdAt" DESC
                LIMIT 100
                """
            ).bindparams(in_slots),
            {"slot_ids": list(SLOTS)},
        )
        rows = r2.mappings().all()
        print("NOTIFICATIONS count", len(rows))
        for row in rows[:40]:
            d = dict(row)
            meta = d.get("metadata") or {}
            sid = meta.get("slotId") if isinstance(meta, dict) else None
            print(d.get("userId"), str(d.get("type")), sid, d.get("createdAt"))

        r3 = await c.execute(
            text(
                """
                SELECT id, "userId", "parsedCodes", "createdAt"
                FROM "RoutineScan"
                WHERE :code = ANY("parsedCodes")
                ORDER BY "createdAt" DESC
                """
            ),
            {"code": "CSE3219"},
        )
        print("ROUTINE_SCANS_CSE3219", [dict(x) for x in r3.mappings().all()])

    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
