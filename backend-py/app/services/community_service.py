from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import logging

from app.core.permissions import ensure_community_manager
from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError, ValidationError

logger = logging.getLogger(__name__)

from app.models.community import (
    Announcement, Community, CommunityMember, MarkUpload, Thread, ThreadLike, ThreadPost
)
from app.models.course import Course, Enrollment, AttendanceRecord, ScheduleSlot
from app.models.enums import CommunityRole, NotificationType, Role
from app.models.user import User
from app.services.course_identity import find_course_by_code, normalize_course_code
from app.services import notification_service
from app.services.cloudinary_service import upload_file
from app.services.spreadsheet_service import (
    ParsedMarkRow,
    infer_assessment_field_from_label,
    parse_marks_spreadsheet,
)
from app.core.socket import emit_community_updated, emit_course_analytics_updated


def _normalize_join_field(value: str) -> str:
    """Case-insensitive, strip edges, collapse internal whitespace — reduces join friction."""
    return " ".join((value or "").split()).casefold()


async def _hide_student_only_announcements_from_viewer(
    db: AsyncSession, community_id: str, viewer_user_id: str
) -> bool:
    """Return True if ``student_feed_only`` announcements should be omitted for this viewer.

    Aligns with who can manage a classroom (``ensure_community_manager``): platform admins,
    the community creator, and members with community role TUTOR must not receive the same
    student-facing-only feed (e.g. marks-upload copy) that students see.

    Without this, ``Role.ADMIN`` users would bypass the filter (old behavior) even though the
    frontend treats all admins as ``canManageClassroom`` and shows the tutor announcement UI.
    Classroom creators who lack a ``CommunityMember`` row (legacy / data issues) are also
    covered via ``Community.created_by``.
    """
    viewer = await db.get(User, viewer_user_id)
    if viewer and viewer.role == Role.ADMIN:
        return True

    community = await db.get(Community, community_id)
    if community and community.created_by == viewer_user_id:
        return True

    member = (
        await db.execute(
            select(CommunityMember).where(
                CommunityMember.community_id == community_id,
                CommunityMember.user_id == viewer_user_id,
            )
        )
    ).scalar_one_or_none()
    if member and member.role == CommunityRole.TUTOR:
        return True
    return False


async def _require_community_manager(db: AsyncSession, community_id: str, user_id: str) -> Community:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    user = await db.get(User, user_id)
    if not user:
        raise NotFoundError("User not found")
    await ensure_community_manager(db, user, community_id)
    return community


# ── Thread helpers ────────────────────────────────────────────────────────────

async def _thread_dict(db: AsyncSession, thread: Thread, user_id: str | None = None) -> dict:
    creator = await db.get(User, thread.creator_id)
    course = await db.get(Course, thread.course_id) if thread.course_id else None
    post_count = (await db.execute(
        select(func.count(ThreadPost.id)).where(ThreadPost.thread_id == thread.id)
    )).scalar_one()
    like_count = (await db.execute(
        select(func.count(ThreadLike.id)).where(ThreadLike.thread_id == thread.id)
    )).scalar_one()
    return {
        "id": thread.id,
        "title": thread.title,
        "body": thread.body,
        "courseId": thread.course_id,
        "tags": thread.tags or [],
        "createdAt": thread.created_at,
        "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
        "course": {"courseCode": course.course_code} if course else None,
        "_count": {"posts": post_count, "likes": like_count},
    }


# ── Threads ───────────────────────────────────────────────────────────────────

async def list_threads(
    db: AsyncSession, user_id: str, tab: str | None, course_id: str | None,
    tag: str | None, page: int, limit: int,
) -> tuple[list[dict], int]:
    stmt = select(Thread)

    if tab == "my-courses":
        enrolled_courses = (await db.execute(
            select(Enrollment.course_id).where(Enrollment.user_id == user_id)
        )).scalars().all()
        stmt = stmt.where(Thread.course_id.in_(enrolled_courses))
    if course_id:
        stmt = stmt.where(Thread.course_id == course_id)
    if tag:
        stmt = stmt.where(Thread.tags.contains([tag]))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()
    threads = (await db.execute(
        stmt.order_by(Thread.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    return [await _thread_dict(db, t, user_id) for t in threads], total


async def create_thread(db: AsyncSession, user_id: str, data: dict) -> dict:
    thread = Thread(
        title=data["title"],
        body=data["body"],
        course_id=data.get("courseId"),
        creator_id=user_id,
        tags=data.get("tags", []),
    )
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    return await _thread_dict(db, thread, user_id)


async def get_thread(db: AsyncSession, thread_id: str, user_id: str) -> dict:
    thread = await db.get(Thread, thread_id)
    if not thread:
        raise NotFoundError("Thread not found")

    creator = await db.get(User, thread.creator_id)
    course = await db.get(Course, thread.course_id) if thread.course_id else None

    posts_raw = (await db.execute(
        select(ThreadPost).where(ThreadPost.thread_id == thread_id).order_by(ThreadPost.created_at.asc())
    )).scalars().all()

    posts = []
    for p in posts_raw:
        author = await db.get(User, p.author_id)
        posts.append({
            "id": p.id,
            "content": p.content,
            "fileUrl": p.file_url,
            "createdAt": p.created_at,
            "author": {"id": author.id, "name": author.name, "avatarUrl": author.avatar_url} if author else None,
        })

    user_liked = (await db.execute(
        select(ThreadLike).where(ThreadLike.thread_id == thread_id, ThreadLike.user_id == user_id)
    )).scalar_one_or_none() is not None

    like_count = (await db.execute(
        select(func.count(ThreadLike.id)).where(ThreadLike.thread_id == thread_id)
    )).scalar_one()

    return {
        "id": thread.id,
        "title": thread.title,
        "body": thread.body,
        "courseId": thread.course_id,
        "tags": thread.tags or [],
        "createdAt": thread.created_at,
        "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
        "course": {"courseCode": course.course_code, "courseName": course.course_name} if course else None,
        "posts": posts,
        "likes": [{"userId": user_id}] if user_liked else [],
        "_count": {"posts": len(posts), "likes": like_count},
    }


async def _notify_thread_owner_new_reply(
    db: AsyncSession, thread: Thread, replier_id: str, post_id: str
) -> None:
    if thread.creator_id == replier_id:
        return
    owner = await db.get(User, thread.creator_id)
    if not owner or not owner.notif_chat:
        return
    replier = await db.get(User, replier_id)
    replier_name = replier.name if replier else "Someone"
    meta: dict = {
        "notificationKey": f"thread_reply:{post_id}",
        "kind": "THREAD_REPLY",
        "threadId": thread.id,
        "deepLink": f"/community/threads/{thread.id}",
    }
    if thread.course_id:
        meta["courseId"] = thread.course_id
    await notification_service.create_notification(
        db,
        thread.creator_id,
        NotificationType.MESSAGE,
        f'{replier_name} replied to your thread',
        "Open the thread to read the new reply.",
        metadata=meta,
    )


async def _notify_thread_owner_new_like(db: AsyncSession, thread: Thread, liker_id: str) -> None:
    if thread.creator_id == liker_id:
        return
    owner = await db.get(User, thread.creator_id)
    if not owner or not owner.notif_chat:
        return
    meta: dict = {
        "notificationKey": f"thread_like:{thread.id}:{liker_id}",
        "kind": "THREAD_LIKE",
        "threadId": thread.id,
        "deepLink": f"/community/threads/{thread.id}",
    }
    if thread.course_id:
        meta["courseId"] = thread.course_id
    liker = await db.get(User, liker_id)
    liker_name = liker.name if liker else "Someone"
    await notification_service.create_notification(
        db,
        thread.creator_id,
        NotificationType.MESSAGE,
        f"{liker_name} liked your thread",
        "Someone appreciated your post in the community.",
        metadata=meta,
    )


async def create_post(db: AsyncSession, thread_id: str, user_id: str, content: str, file_url: str | None) -> dict:
    post = ThreadPost(thread_id=thread_id, author_id=user_id, content=content, file_url=file_url)
    db.add(post)
    await db.flush()
    thread = await db.get(Thread, thread_id)
    if thread:
        try:
            await _notify_thread_owner_new_reply(db, thread, user_id, post.id)
        except Exception:
            logger.exception("thread reply notification failed for thread %s", thread_id)
    await db.commit()
    await db.refresh(post)
    author = await db.get(User, user_id)
    return {
        "id": post.id,
        "content": post.content,
        "fileUrl": post.file_url,
        "createdAt": post.created_at,
        "author": {"id": author.id, "name": author.name, "avatarUrl": author.avatar_url} if author else None,
    }


async def delete_thread(db: AsyncSession, thread_id: str, user_id: str) -> dict:
    thread = await db.get(Thread, thread_id)
    if not thread:
        raise NotFoundError("Thread not found")
    if thread.creator_id != user_id:
        raise ForbiddenError("You can only delete your own threads")
    await db.delete(thread)
    await db.commit()
    return {"message": "Thread deleted"}


async def like_thread(db: AsyncSession, thread_id: str, user_id: str) -> dict:
    existing = (await db.execute(
        select(ThreadLike).where(ThreadLike.thread_id == thread_id, ThreadLike.user_id == user_id)
    )).scalar_one_or_none()
    if existing:
        return {"liked": True, "message": "Already liked"}
    db.add(ThreadLike(thread_id=thread_id, user_id=user_id))
    await db.flush()
    thread = await db.get(Thread, thread_id)
    if thread:
        try:
            await _notify_thread_owner_new_like(db, thread, user_id)
        except Exception:
            logger.exception("thread like notification failed for thread %s", thread_id)
    await db.commit()
    return {"liked": True}


async def unlike_thread(db: AsyncSession, thread_id: str, user_id: str) -> dict:
    existing = (await db.execute(
        select(ThreadLike).where(ThreadLike.thread_id == thread_id, ThreadLike.user_id == user_id)
    )).scalar_one_or_none()
    if existing:
        await db.delete(existing)
        await db.commit()
    return {"liked": False}


# ── Community CRUD ────────────────────────────────────────────────────────────

async def create_community(db: AsyncSession, user_id: str, data: dict) -> dict:
    # Classroom course "match" is the same as routine: normalized course code resolves to one
    # canonical Course row (see find_course_by_code). Community.course_id points at that row,
    # same as Enrollment after join / routine bulk_create — no separate fuzzy string graph.
    requested_course_code = normalize_course_code(data["courseCode"])
    course = await find_course_by_code(db, requested_course_code)
    if not course:
        course = Course(course_code=requested_course_code, course_name=requested_course_code)
        db.add(course)
        await db.flush()

    community = Community(
        name=data["name"],
        description=data.get("description"),
        course_id=course.id,
        course_code=course.course_code,
        session=data["session"],
        department=data["department"],
        university=data["university"],
        created_by=user_id,
    )
    db.add(community)
    await db.flush()

    db.add(CommunityMember(community_id=community.id, user_id=user_id, role=CommunityRole.TUTOR))

    existing_enrollment = (await db.execute(
        select(Enrollment).where(Enrollment.user_id == user_id, Enrollment.course_id == course.id)
    )).scalar_one_or_none()
    if not existing_enrollment:
        db.add(Enrollment(user_id=user_id, course_id=course.id))

    await db.commit()
    await db.refresh(community)

    creator = await db.get(User, user_id)
    member_count = (await db.execute(
        select(func.count(CommunityMember.id)).where(CommunityMember.community_id == community.id)
    )).scalar_one()

    return {
        "id": community.id,
        "name": community.name,
        "description": community.description,
        "courseId": community.course_id,
        "courseCode": community.course_code,
        "session": community.session,
        "department": community.department,
        "university": community.university,
        "createdAt": community.created_at,
        "course": {"courseCode": course.course_code, "courseName": course.course_name},
        "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
        "_count": {"members": member_count},
    }


async def list_communities(
    db: AsyncSession, user_id: str, tab: str | None, page: int, limit: int
) -> tuple[list[dict], int]:
    stmt = select(Community)

    if tab == "my":
        member_subq = select(CommunityMember.community_id).where(CommunityMember.user_id == user_id).scalar_subquery()
        stmt = stmt.where(Community.id.in_(member_subq))
    elif tab == "eligible":
        user = await db.get(User, user_id)
        university = user.university_name if user else None
        not_member_subq = select(CommunityMember.community_id).where(CommunityMember.user_id == user_id).scalar_subquery()
        enrolled_course_ids = select(Enrollment.course_id).where(Enrollment.user_id == user_id).scalar_subquery()
        # Students may see classrooms for courses they are enrolled in even if university string mismatches.
        if user and user.role == Role.STUDENT:
            visibility = or_(
                Community.university == university,
                Community.course_id.in_(enrolled_course_ids),
            )
        else:
            visibility = Community.university == university
        stmt = stmt.where(visibility, Community.id.notin_(not_member_subq))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    communities = (await db.execute(
        stmt.order_by(Community.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    result = []
    for c in communities:
        creator = await db.get(User, c.created_by)
        course = await db.get(Course, c.course_id)
        member_count = (await db.execute(
            select(func.count(CommunityMember.id)).where(CommunityMember.community_id == c.id)
        )).scalar_one()
        result.append({
            "id": c.id, "name": c.name, "description": c.description,
            "courseId": c.course_id, "courseCode": c.course_code,
            "session": c.session, "department": c.department, "university": c.university,
            "createdAt": c.created_at,
            "course": {"courseCode": course.course_code, "courseName": course.course_name} if course else None,
            "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
            "_count": {"members": member_count},
        })
    return result, total


async def get_community(db: AsyncSession, community_id: str) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")

    creator = await db.get(User, community.created_by)
    course = await db.get(Course, community.course_id)
    members_raw = (await db.execute(
        select(CommunityMember).where(CommunityMember.community_id == community_id).order_by(CommunityMember.joined_at.asc())
    )).scalars().all()

    members = []
    for m in members_raw:
        u = await db.get(User, m.user_id)
        members.append({
            "id": m.id, "userId": m.user_id, "communityId": m.community_id, "role": m.role, "joinedAt": m.joined_at,
            "user": {"id": u.id, "name": u.name, "avatarUrl": u.avatar_url, "rollNumber": u.roll_number, "email": u.email} if u else None,
        })

    ann_count = (await db.execute(
        select(func.count(Announcement.id)).where(Announcement.community_id == community_id)
    )).scalar_one()

    schedule_slots_raw = (await db.execute(
        select(ScheduleSlot).where(ScheduleSlot.course_id == community.course_id).order_by(ScheduleSlot.day_of_week, ScheduleSlot.start_time)
    )).scalars().all()
    schedule_slots = [
        {"id": s.id, "dayOfWeek": s.day_of_week, "startTime": s.start_time, "endTime": s.end_time, "type": s.type, "room": s.room}
        for s in schedule_slots_raw
    ]

    return {
        "id": community.id, "name": community.name, "description": community.description,
        "courseId": community.course_id, "courseCode": community.course_code,
        "session": community.session, "department": community.department, "university": community.university,
        "createdAt": community.created_at,
        "course": {"id": course.id, "courseCode": course.course_code, "courseName": course.course_name} if course else None,
        "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
        "members": members,
        "scheduleSlots": schedule_slots,
        "_count": {"members": len(members), "announcements": ann_count},
    }


async def join_community(
    db: AsyncSession,
    community_id: str,
    user_id: str,
    roll_number: str,
    session: str,
    department: str,
    university: str,
) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")

    user = await db.get(User, user_id)
    if _normalize_join_field(university) != _normalize_join_field(community.university):
        raise ForbiddenError("University does not match this classroom")
    if _normalize_join_field(session) != _normalize_join_field(community.session):
        raise ForbiddenError("Session does not match this classroom")
    if _normalize_join_field(department) != _normalize_join_field(community.department):
        raise ForbiddenError("Department does not match this classroom")

    existing = (await db.execute(
        select(CommunityMember).where(CommunityMember.community_id == community_id, CommunityMember.user_id == user_id)
    )).scalar_one_or_none()
    if existing:
        raise ConflictError("Already a member of this community")

    if user:
        user.roll_number = roll_number
        user.session = session
        user.department = department
        user.university_name = community.university

    member = CommunityMember(community_id=community_id, user_id=user_id, role=CommunityRole.STUDENT)
    db.add(member)

    existing_enrollment = (await db.execute(
        select(Enrollment).where(Enrollment.user_id == user_id, Enrollment.course_id == community.course_id)
    )).scalar_one_or_none()
    if not existing_enrollment:
        db.add(Enrollment(user_id=user_id, course_id=community.course_id))

    await db.commit()
    await db.refresh(member)
    await emit_community_updated(community_id, community.course_id)
    await emit_course_analytics_updated(community.course_id)
    return {"id": member.id, "userId": member.user_id, "communityId": member.community_id, "role": member.role, "joinedAt": member.joined_at}


async def leave_community(db: AsyncSession, community_id: str, user_id: str) -> dict:
    member = (await db.execute(
        select(CommunityMember).where(CommunityMember.community_id == community_id, CommunityMember.user_id == user_id)
    )).scalar_one_or_none()
    if member:
        comm = await db.get(Community, community_id)
        await db.delete(member)
        await db.commit()
        if comm:
            await emit_community_updated(community_id, comm.course_id)
    return {"message": "Left community"}


async def remove_member(db: AsyncSession, community_id: str, target_user_id: str, requester_id: str) -> dict:
    await _require_community_manager(db, community_id, requester_id)
    member = (await db.execute(
        select(CommunityMember).where(CommunityMember.community_id == community_id, CommunityMember.user_id == target_user_id)
    )).scalar_one_or_none()
    if member:
        comm = await db.get(Community, community_id)
        await db.delete(member)
        await db.commit()
        if comm:
            await emit_community_updated(community_id, comm.course_id)
    return {"message": "Member removed"}


# ── Announcements ─────────────────────────────────────────────────────────────

async def create_announcement(db: AsyncSession, community_id: str, user_id: str, title: str, body: str, file_url: str | None) -> dict:
    community = await _require_community_manager(db, community_id, user_id)

    announcement = Announcement(community_id=community_id, author_id=user_id, title=title, body=body, file_url=file_url)
    db.add(announcement)
    await db.flush()

    student_ids = (await db.execute(
        select(CommunityMember.user_id).where(
            CommunityMember.community_id == community_id,
            CommunityMember.role == CommunityRole.STUDENT,
        )
    )).scalars().all()

    for sid in student_ids:
        await notification_service.create_notification(
            db, sid, NotificationType.ANNOUNCEMENT,
            f"New announcement in {community.name}", title,
            metadata={
                "notificationKey": f"announcement:{announcement.id}:{sid}",
                "kind": "CLASSROOM_ANNOUNCEMENT",
                "communityId": community.id,
                "announcementId": announcement.id,
                "deepLink": f"/community/{community_id}",
            },
        )

    await db.commit()
    await db.refresh(announcement)
    author = await db.get(User, user_id)
    return {
        "id": announcement.id, "title": announcement.title, "body": announcement.body,
        "fileUrl": announcement.file_url,
        "studentFeedOnly": announcement.student_feed_only,
        "communityId": announcement.community_id,
        "createdAt": announcement.created_at,
        "author": {"id": author.id, "name": author.name, "avatarUrl": author.avatar_url} if author else None,
    }


async def list_announcements(
    db: AsyncSession, community_id: str, viewer_user_id: str, page: int, limit: int
) -> tuple[list[dict], int]:
    hide_student_only = await _hide_student_only_announcements_from_viewer(db, community_id, viewer_user_id)
    filters = [Announcement.community_id == community_id]
    if hide_student_only:
        filters.append(Announcement.student_feed_only.is_(False))

    total = (await db.execute(select(func.count(Announcement.id)).where(*filters))).scalar_one()
    announcements = (
        await db.execute(
            select(Announcement)
            .where(*filters)
            .order_by(Announcement.created_at.desc())
            .offset((page - 1) * limit)
            .limit(limit)
        )
    ).scalars().all()

    result = []
    for a in announcements:
        author = await db.get(User, a.author_id)
        result.append({
            "id": a.id, "title": a.title, "body": a.body, "fileUrl": a.file_url,
            "studentFeedOnly": a.student_feed_only,
            "createdAt": a.created_at,
            "author": {"id": author.id, "name": author.name, "avatarUrl": author.avatar_url} if author else None,
        })
    return result, total


async def delete_announcement(db: AsyncSession, announcement_id: str, user_id: str) -> dict:
    ann = await db.get(Announcement, announcement_id)
    if not ann:
        raise NotFoundError("Announcement not found")
    if ann.author_id != user_id:
        raise ForbiddenError("Only the author can delete this announcement")
    await db.delete(ann)
    await db.commit()
    return {"message": "Announcement deleted"}


# ── Marks ─────────────────────────────────────────────────────────────────────

def _sanitize_assessment_label(raw: str | None) -> str | None:
    if raw is None:
        return None
    s = " ".join(str(raw).strip().split())
    if len(s) > 80:
        s = s[:80].rstrip()
    return s or None


def _normalize_roll_key(value: str) -> str:
    return " ".join((value or "").split()).casefold()


def _apply_parsed_marks_to_enrollment(enrollment: Enrollment, row: ParsedMarkRow) -> bool:
    changed = False
    for attr in ("ct_score1", "ct_score2", "ct_score3", "lab_score"):
        val = getattr(row, attr, None)
        if val is not None:
            setattr(enrollment, attr, val)
            changed = True
    return changed


async def upload_marks(
    db: AsyncSession,
    community_id: str,
    user_id: str,
    file_data: bytes,
    filename: str,
    assessment_label: str | None = None,
) -> dict:
    """Store marks file, parse CSV/XLSX (Path B — no PDF), update official enrollment scores, notify students."""
    community = await _require_community_manager(db, community_id, user_id)

    upload_result = await upload_file(file_data, "mark-uploads")
    secure_url = upload_result["secure_url"]

    course = await db.get(Course, community.course_id)
    course_code = course.course_code if course else community.course_code

    label = _sanitize_assessment_label(assessment_label)
    assessment_field = infer_assessment_field_from_label(label)

    parse_result = parse_marks_spreadsheet(file_data, filename or "upload", assessment_field)

    enroll_rows = (
        await db.execute(
            select(Enrollment, User)
            .join(User, Enrollment.user_id == User.id)
            .where(
                Enrollment.course_id == community.course_id,
                Enrollment.user_id.in_(
                    select(CommunityMember.user_id).where(
                        CommunityMember.community_id == community_id,
                        CommunityMember.role == CommunityRole.STUDENT,
                    )
                ),
            )
        )
    ).all()

    roll_to_enrollment: dict[str, Enrollment] = {}
    for enr, u in enroll_rows:
        if u.roll_number:
            roll_to_enrollment[_normalize_roll_key(u.roll_number)] = enr

    updated = 0
    unmatched: list[dict] = []
    for rec in parse_result.records:
        key = _normalize_roll_key(rec.roll_number)
        enr = roll_to_enrollment.get(key)
        if not enr:
            unmatched.append({"row": rec.row, "rollNumber": rec.roll_number, "reason": "No enrolled student with this roll"})
            continue
        if _apply_parsed_marks_to_enrollment(enr, rec):
            updated += 1

    err_items: list[dict] = [
        {"row": e.row, "rollNumber": e.roll_number, "reason": e.reason} for e in parse_result.errors
    ]
    err_items.extend(unmatched)

    mark_upload = MarkUpload(
        community_id=community_id,
        uploaded_by=user_id,
        file_url=secure_url,
        processed_count=len(parse_result.records),
        error_count=len(err_items),
        errors={"items": err_items[:100]} if err_items else None,
    )
    db.add(mark_upload)
    await db.flush()

    if updated > 0:
        ann_title = f"{course_code} — {label} marks posted" if label else f"{course_code} — marks posted"
        ann_body = (
            f"Your instructor recorded official marks{f' for {label}' if label else ''}. "
            f"Open your course page — My Scores shows instructor-recorded CT/lab marks for {course_code}."
        )
    else:
        ann_title = f"{course_code} — {label} file posted" if label else f"{course_code} — marks file posted"
        ann_body = (
            f"Your instructor uploaded a marks file ({filename}){f' for {label}' if label else ''}. "
            "If scores do not appear yet, check that roll numbers in the file match your profile."
        )

    announcement = Announcement(
        community_id=community_id,
        author_id=user_id,
        title=ann_title,
        body=ann_body,
        file_url=secure_url,
        student_feed_only=True,
    )
    db.add(announcement)
    await db.flush()

    student_ids = (
        await db.execute(
            select(CommunityMember.user_id).where(
                CommunityMember.community_id == community_id,
                CommunityMember.role == CommunityRole.STUDENT,
            )
        )
    ).scalars().all()

    notif_title = (
        f"{course_code} {label} marks uploaded! Check your marks!"
        if label
        else f"{course_code} marks uploaded! Check your marks!"
    )
    notif_body = (
        f"Official marks{f' for {label}' if label else ''} are on your course page under My Scores."
        if updated > 0
        else (
            f"Your instructor posted a marks file{f' for {label}' if label else ''}. Open your course page for details."
        )
    )

    for sid in student_ids:
        await notification_service.create_notification(
            db=db,
            user_id=sid,
            type=NotificationType.ANNOUNCEMENT,
            title=notif_title,
            body=notif_body,
            metadata={
                "notificationKey": f"marks_upload:{mark_upload.id}:{sid}",
                "kind": "CT_MARKS_FILE_UPLOADED",
                "communityId": community.id,
                "courseId": community.course_id,
                "courseCode": course_code,
                "assessmentLabel": label,
                "markUploadId": mark_upload.id,
                "announcementId": announcement.id,
                "deepLink": f"/courses/{community.course_id}",
            },
        )

    await db.commit()
    await emit_course_analytics_updated(community.course_id)
    await emit_community_updated(community_id, community.course_id)

    return {
        "upload": {"id": mark_upload.id},
        "processed": len(parse_result.records),
        "updated": updated,
        "errors": err_items[:50],
    }


async def get_marks_history(db: AsyncSession, community_id: str) -> list[dict]:
    uploads = (await db.execute(
        select(MarkUpload).where(MarkUpload.community_id == community_id).order_by(MarkUpload.created_at.desc())
    )).scalars().all()
    result = []
    for u in uploads:
        uploader = await db.get(User, u.uploaded_by)
        result.append({
            "id": u.id, "fileUrl": u.file_url, "processedCount": u.processed_count,
            "errorCount": u.error_count, "errors": u.errors, "createdAt": u.created_at,
            "uploader": {"id": uploader.id, "name": uploader.name} if uploader else None,
        })
    return result


async def get_community_scores(db: AsyncSession, community_id: str) -> list[dict]:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    student_member_ids = (
        select(CommunityMember.user_id).where(
            CommunityMember.community_id == community_id,
            CommunityMember.role == CommunityRole.STUDENT,
        )
    ).scalar_subquery()
    enrollments = (await db.execute(
        select(Enrollment).where(
            Enrollment.course_id == community.course_id,
            Enrollment.user_id.in_(student_member_ids),
        )
    )).scalars().all()
    result = []
    for e in enrollments:
        u = await db.get(User, e.user_id)
        result.append({
            "userId": e.user_id,
            "name": u.name if u else None,
            "rollNumber": u.roll_number if u else None,
            "email": u.email if u else None,
            "ctScore1": e.ct_score1,
            "ctScore2": e.ct_score2,
            "ctScore3": e.ct_score3,
            "labScore": e.lab_score,
            "studentTheoryCt1": e.student_theory_ct1,
            "studentTheoryCt2": e.student_theory_ct2,
            "studentTheoryCt3": e.student_theory_ct3,
            "studentTheoryAssignment": e.student_theory_assignment,
        })
    return result


# ── Attendance ────────────────────────────────────────────────────────────────

async def record_attendance(
    db: AsyncSession, community_id: str, user_id: str,
    slot_id: str, date_str: str, records: list[dict],
) -> dict:
    """Deprecated: roll-call was removed. Attendance comes only from student class notifications."""
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    raise ForbiddenError(
        "Roll-call attendance is no longer available. Students record attendance from their class notifications."
    )


async def get_community_attendance(
    db: AsyncSession, community_id: str,
    slot_id: str | None, from_date: str | None, to_date: str | None,
) -> list[dict]:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")

    stmt = (
        select(AttendanceRecord, User, ScheduleSlot)
        .join(User, AttendanceRecord.user_id == User.id)
        .join(ScheduleSlot, AttendanceRecord.slot_id == ScheduleSlot.id)
        .where(ScheduleSlot.course_id == community.course_id)
    )
    if slot_id:
        stmt = stmt.where(AttendanceRecord.slot_id == slot_id)
    if from_date:
        stmt = stmt.where(AttendanceRecord.date >= datetime.fromisoformat(from_date.replace("Z", "+00:00")))
    if to_date:
        stmt = stmt.where(AttendanceRecord.date <= datetime.fromisoformat(to_date.replace("Z", "+00:00")))
    stmt = stmt.order_by(AttendanceRecord.date.desc())

    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": a.id, "date": a.date, "present": a.present,
            "user": {"id": u.id, "name": u.name, "rollNumber": u.roll_number},
            "slot": {"dayOfWeek": s.day_of_week, "startTime": s.start_time, "endTime": s.end_time, "type": s.type},
        }
        for a, u, s in rows
    ]


async def get_my_attendance(db: AsyncSession, community_id: str, user_id: str) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")

    rows = (await db.execute(
        select(AttendanceRecord, ScheduleSlot)
        .join(ScheduleSlot, AttendanceRecord.slot_id == ScheduleSlot.id)
        .where(AttendanceRecord.user_id == user_id, ScheduleSlot.course_id == community.course_id)
        .order_by(AttendanceRecord.date.desc())
    )).all()

    records = [
        {"id": a.id, "date": a.date, "present": a.present, "slot": {"dayOfWeek": s.day_of_week, "startTime": s.start_time, "endTime": s.end_time, "type": s.type}}
        for a, s in rows
    ]
    total = len(records)
    present = sum(1 for r in records if r["present"])
    return {
        "records": records,
        "summary": {"total": total, "present": present, "absent": total - present, "percentage": round((present / total) * 100) if total else 0},
    }
