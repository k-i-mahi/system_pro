"""Centralised resource-level permission helpers.

All helpers raise ForbiddenError or NotFoundError; callers do not need to
repeat the pattern of querying + checking.  Routers import these and call them
with the User object returned by get_current_user().
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, NotFoundError
from app.models.community import Community, CommunityMember
from app.models.course import Enrollment
from app.models.enums import CommunityRole, Role


async def ensure_community_member_or_admin(
    db: AsyncSession,
    user,
    community_id: str,
) -> None:
    """Raise 403 unless the user is a member of the community or an admin."""
    if user.role == Role.ADMIN:
        return
    row = (
        await db.execute(
            select(CommunityMember.id).where(
                CommunityMember.community_id == community_id,
                CommunityMember.user_id == user.id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise ForbiddenError("You are not a member of this classroom")


async def ensure_community_manager(
    db: AsyncSession,
    user,
    community_id: str,
) -> None:
    """Raise 403 unless the user is the community's TUTOR owner or an admin."""
    if user.role == Role.ADMIN:
        return
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    if community.created_by == user.id:
        return
    row = (
        await db.execute(
            select(CommunityMember.id).where(
                CommunityMember.community_id == community_id,
                CommunityMember.user_id == user.id,
                CommunityMember.role == CommunityRole.TUTOR,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise ForbiddenError("Only the classroom tutor or an admin can perform this action")


async def ensure_course_member_or_admin(
    db: AsyncSession,
    user,
    course_id: str,
) -> None:
    """Raise 403 unless the user is enrolled in the course or is an admin."""
    if user.role == Role.ADMIN:
        return
    row = (
        await db.execute(
            select(Enrollment.id).where(
                Enrollment.user_id == user.id,
                Enrollment.course_id == course_id,
            )
        )
    ).scalar_one_or_none()
    if not row:
        raise ForbiddenError("You are not enrolled in this course")


async def is_classroom_owner_for_course(db: AsyncSession, user, course_id: str) -> bool:
    """True for admins, or tutors who *created* the community (classroom) for this course."""
    if user.role == Role.ADMIN:
        return True
    if user.role != Role.TUTOR:
        return False
    row = (
        await db.execute(
            select(Community.id).where(
                Community.course_id == course_id,
                Community.created_by == user.id,
            )
        )
    ).scalar_one_or_none()
    return row is not None


async def ensure_classroom_owner_for_course_or_admin(db: AsyncSession, user, course_id: str) -> None:
    """Raise 403 unless admin or the tutor who created the classroom for this course."""
    if not await is_classroom_owner_for_course(db, user, course_id):
        if user.role == Role.TUTOR:
            raise ForbiddenError(
                "Only the instructor who created the classroom for this course can manage the shared class schedule "
                "and materials. Co-tutors should add content from the classroom view."
            )
        raise ForbiddenError("You don't have permission to manage course content for this course.")


async def ensure_course_tutor_or_admin(
    db: AsyncSession,
    user,
    course_id: str,
) -> None:
    """Raise 403 unless the user is a TUTOR in a community for this course or admin.

    Prefer ensure_classroom_owner_for_course_or_admin for course *materials* and shared topics
    (only the classroom owner may edit those; co-tutors are still tutors in the community).
    """
    if user.role == Role.ADMIN:
        return
    if user.role not in (Role.TUTOR, Role.ADMIN):
        raise ForbiddenError("Only tutors or admins can perform this action")
    row = (
        await db.execute(
            select(CommunityMember.id)
            .join(Community, Community.id == CommunityMember.community_id)
            .where(
                Community.course_id == course_id,
                CommunityMember.user_id == user.id,
                CommunityMember.role == CommunityRole.TUTOR,
            )
        )
    ).scalar_one_or_none()
    # Also allow if tutor is the creator of a community for this course.
    if not row:
        row2 = (
            await db.execute(
                select(Community.id).where(
                    Community.course_id == course_id,
                    Community.created_by == user.id,
                )
            )
        ).scalar_one_or_none()
        if not row2:
            raise ForbiddenError("You are not a tutor for this course")
