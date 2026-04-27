"""
Assign ownerUserId on ScheduleSlot rows (legacy cleanup for multi-student courses).

Usage (after auditing with scripts/audit_null_slots_multi_student.py):

  python scripts/legacy_assign_slot_owners.py \\
    --slot 73bf70ea-f7dd-4e39-ab9c-1f2313b2d406 --user decb4c3d-626b-47e3-9e43-88f648a8914d \\
    --slot d6ebbb50-6530-4e9f-b0de-abc1ec85e478 --user 6022b081-3948-48fe-a856-602cdd4dc172

Only updates rows where ownerUserId IS NULL (idempotent). Commits once at end.
"""
from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_ROOT / ".env")


def _async_url() -> str:
    url = os.environ["DATABASE_URL"]
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


async def _run(pairs: list[tuple[str, str]]) -> None:
    eng = create_async_engine(_async_url())
    Session = async_sessionmaker(eng, expire_on_commit=False)
    async with Session() as session:
        for slot_id, user_id in pairs:
            res = await session.execute(
                text(
                    """
                    UPDATE "ScheduleSlot"
                    SET "ownerUserId" = :uid
                    WHERE id = :sid AND "ownerUserId" IS NULL
                    """
                ),
                {"uid": user_id, "sid": slot_id},
            )
            print(slot_id, "->", user_id, "rowcount", res.rowcount)
        await session.commit()
    await eng.dispose()


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument(
        "--slot",
        action="append",
        dest="slots",
        required=True,
        help="ScheduleSlot id (repeat for each pair)",
    )
    p.add_argument(
        "--user",
        action="append",
        dest="users",
        required=True,
        help="User id to own the slot (same order as --slot)",
    )
    args = p.parse_args()
    if len(args.slots) != len(args.users):
        p.error("same number of --slot and --user values required")
    pairs = list(zip(args.slots, args.users))
    asyncio.run(_run(pairs))


if __name__ == "__main__":
    main()
