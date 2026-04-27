"""One-off: inspect CSE3219 / Jahid schedule data (run from repo with .env loaded)."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / ".env")
load_dotenv(_ROOT / "backend-py" / ".env", override=False)


def _async_url() -> str:
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        print("DATABASE_URL missing", file=sys.stderr)
        sys.exit(1)
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    eng = create_async_engine(_async_url())
    async with eng.connect() as c:
        r = await c.execute(
            text(
                """
                SELECT id, "courseCode", "courseName" FROM "Course"
                WHERE "courseCode" ILIKE :pat OR "courseCode" = :exact
                """
            ),
            {"pat": "%CSE3219%", "exact": "CSE3219"},
        )
        courses = r.mappings().all()
        print("COURSES", [dict(x) for x in courses])
        for row in courses:
            cid = row["id"]
            r2 = await c.execute(
                text(
                    """
                    SELECT u.id, u.email, u.name, u.role
                    FROM "Enrollment" e
                    JOIN "User" u ON u.id = e."userId"
                    WHERE e."courseId" = :cid
                    ORDER BY u.email
                    """
                ),
                {"cid": cid},
            )
            print("ENROLLMENTS", cid, [dict(x) for x in r2.mappings().all()])
            r3 = await c.execute(
                text(
                    """
                    SELECT id, "dayOfWeek", "startTime", "endTime", "ownerUserId", type
                    FROM "ScheduleSlot"
                    WHERE "courseId" = :cid
                    ORDER BY "dayOfWeek", "startTime"
                    """
                ),
                {"cid": cid},
            )
            print("SLOTS", [dict(x) for x in r3.mappings().all()])
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
