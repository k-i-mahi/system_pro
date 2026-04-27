"""List courses with 2+ student enrollments that still have ownerUserId IS NULL slots."""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def _async_url() -> str:
    url = os.environ["DATABASE_URL"]
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    eng = create_async_engine(_async_url())
    async with eng.connect() as c:
        r = await c.execute(
            text(
                """
                WITH multi AS (
                  SELECT e."courseId" AS cid, COUNT(*) AS student_cnt
                  FROM "Enrollment" e
                  JOIN "User" u ON u.id = e."userId"
                  WHERE u.role = 'STUDENT'
                  GROUP BY e."courseId"
                  HAVING COUNT(*) >= 2
                )
                SELECT c."courseCode", c."courseName", m.student_cnt,
                       COUNT(s.id) AS null_owner_slots
                FROM multi m
                JOIN "Course" c ON c.id = m.cid
                JOIN "ScheduleSlot" s ON s."courseId" = m.cid AND s."ownerUserId" IS NULL
                GROUP BY c.id, c."courseCode", c."courseName", m.student_cnt
                ORDER BY null_owner_slots DESC, c."courseCode"
                """
            )
        )
        rows = [dict(x) for x in r.mappings().all()]
        print("AFFECTED_COURSE_COUNT", len(rows))
        for row in rows:
            print(row)
    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
