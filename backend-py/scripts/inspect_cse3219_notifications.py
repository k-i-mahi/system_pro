from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import create_async_engine

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

url = os.environ["DATABASE_URL"].replace("postgresql://", "postgresql+asyncpg://", 1)
SLOTS = (
    "d6ebbb50-6530-4e9f-b0de-abc1ec85e478",
    "64b9bddc-499a-4d10-b438-5319fdd675c4",
    "73bf70ea-f7dd-4e39-ab9c-1f2313b2d406",
)


async def main() -> None:
    eng = create_async_engine(url)
    bp = bindparam("slot_ids", expanding=True)
    async with eng.connect() as c:
        r = await c.execute(
            text(
                """
                SELECT n."userId", u.email, n.type::text, n.metadata->>'slotId' AS sid,
                       n.metadata->>'courseCode' AS code, n."createdAt"
                FROM "Notification" n
                JOIN "User" u ON u.id = n."userId"
                WHERE n.metadata->>'courseCode' = 'CSE3219'
                   OR n.metadata->>'slotId' IN :slot_ids
                ORDER BY n."createdAt" DESC
                LIMIT 120
                """
            ).bindparams(bp),
            {"slot_ids": list(SLOTS)},
        )
        for row in r.mappings():
            print(dict(row))
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
