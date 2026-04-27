"""
Assign legacy NULL ScheduleSlot rows for CSE3219 to the correct students.

Evidence used (see inspect scripts):
- Jahid Hasan scanned routine including CSE3219; user requirement: SUN 11:00–11:40 is Jahid's.
- Tue/Wed NULL slots had no student Notification trail; original incident paired Jahid vs Sumaiya Akter.
- Akter has earlier RoutineScan rows for CSE3219; attendance sample linked Akter to the SUN slot id
  (legacy shared-slot artifact).

Run: python scripts/fix_cse3219_schedule_ownership.py
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / ".env")

COURSE_CODE = "CSE3219"

# From live DB inspection 2026-04-26
COURSE_ID = "b35d43c1-172a-4835-bed2-954565ff8bc1"
JAHID_USER_ID = "decb4c3d-626b-47e3-9e43-88f648a8914d"
AKTER_USER_ID = "6022b081-3948-48fe-a856-602cdd4dc172"

SLOT_SUN = "73bf70ea-f7dd-4e39-ab9c-1f2313b2d406"  # SUN 11:00–11:40
SLOT_TUE = "d6ebbb50-6530-4e9f-b0de-abc1ec85e478"  # TUE 09:40–10:20
SLOT_WED = "64b9bddc-499a-4d10-b438-5319fdd675c4"  # WED 11:00–11:40


def _async_url() -> str:
    url = os.environ["DATABASE_URL"]
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def main() -> None:
    eng = create_async_engine(_async_url())
    Session = async_sessionmaker(eng, expire_on_commit=False)

    async with Session() as session:
        before = (
            await session.execute(
                text(
                    """
                    SELECT id, "dayOfWeek", "startTime", "endTime", "ownerUserId"
                    FROM "ScheduleSlot"
                    WHERE "courseId" = :cid
                    ORDER BY "dayOfWeek", "startTime"
                    """
                ),
                {"cid": COURSE_ID},
            )
        ).mappings().all()
        print("BEFORE", [dict(r) for r in before])

        updates = [
            (SLOT_SUN, JAHID_USER_ID, "Jahid Hasan SUN personal"),
            (SLOT_TUE, AKTER_USER_ID, "Sumaiya Akter TUE personal"),
            (SLOT_WED, AKTER_USER_ID, "Sumaiya Akter WED personal"),
        ]
        for slot_id, owner_id, note in updates:
            res = await session.execute(
                text(
                    """
                    UPDATE "ScheduleSlot"
                    SET "ownerUserId" = :owner
                    WHERE id = :sid AND "courseId" = :cid AND "ownerUserId" IS NULL
                    """
                ),
                {"owner": owner_id, "sid": slot_id, "cid": COURSE_ID},
            )
            print("UPDATE", note, "rowcount", res.rowcount)

        after = (
            await session.execute(
                text(
                    """
                    SELECT id, "dayOfWeek", "startTime", "endTime", "ownerUserId"
                    FROM "ScheduleSlot"
                    WHERE "courseId" = :cid
                    ORDER BY "dayOfWeek", "startTime"
                    """
                ),
                {"cid": COURSE_ID},
            )
        ).mappings().all()
        print("AFTER", [dict(r) for r in after])
        await session.commit()

    # Verify routine slice via same service as API
    from app.db.session import AsyncSessionLocal
    from app.services import routine_service

    async with AsyncSessionLocal() as db:
        sched = await routine_service.get_schedule(db, JAHID_USER_ID)
        cse = [s for s in sched if s.get("courseCode") == COURSE_CODE]
        print("JAHID_ROUTINE_CSE3219_SLOTS", cse)

    await eng.dispose()


if __name__ == "__main__":
    asyncio.run(main())
