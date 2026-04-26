from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import Course


def normalize_course_code(value: str) -> str:
    return value.strip().upper()


def course_code_key(value: str) -> str:
    return normalize_course_code(value).replace(" ", "").replace("-", "")


async def find_course_by_code(db: AsyncSession, course_code: str) -> Course | None:
    key = course_code_key(course_code)
    if not key:
        return None

    result = await db.execute(
        select(Course).where(
            func.replace(func.replace(func.upper(Course.course_code), " ", ""), "-", "") == key
        )
    )
    return result.scalar_one_or_none()
