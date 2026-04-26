from __future__ import annotations

import asyncio
import logging
from datetime import datetime, time, timezone

from sqlalchemy import and_, case, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.permissions import ensure_classroom_owner_for_course_or_admin, is_classroom_owner_for_course
from app.core.timezones import user_timezone
from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.models.community import Community, CommunityMember
from app.models.course import AttendanceRecord, Course, Enrollment, Material, ScheduleSlot, Topic, TopicProgress
from app.models.enums import CommunityRole, DayOfWeek, IngestStatus, MaterialType, NotificationType, OcrQuality, Role, TopicStatus
from app.models.misc import Notification
from app.models.user import User
from app.schemas.courses import (
    AddMaterialLinkRequest,
    CoursesQuery,
    CreateTopicRequest,
    ReorderTopicsRequest,
    UpdateMaterialRequest,
    UpdateTopicRequest,
)
from app.services import notification_service
from app.services import cloudinary_service
from app.services.ingest_service import ingest_material_resilient
from app.workers.queues import enqueue_ingest

logger = logging.getLogger(__name__)


def _ingest_background_done(task: asyncio.Task) -> None:
    try:
        exc = task.exception()
        if exc is not None:
            logger.exception("Background ingest task raised: %s", exc)
            return
        result = task.result()
        if isinstance(result, dict) and not result.get("ok"):
            logger.error("Ingest failed: material=%s error=%s", result.get("materialId"), result.get("error"))
    except Exception as e:  # noqa: BLE001
        logger.exception("Ingest task callback error: %s", e)


async def _schedule_material_ingest(material_id: str, user_id: str, quality: str) -> None:
    """Index for RAG: ARQ queue, or in-process (optionally await until embeddings are stored)."""
    if settings.INGEST_USE_ARQ_QUEUE:
        if settings.INGEST_AWAIT:
            logger.warning(
                "INGEST_USE_ARQ_QUEUE is on — Ask Course indexing runs in the ARQ worker; "
                "set INGEST_USE_ARQ_QUEUE=false to wait for ingest in the API process."
            )
        try:
            await enqueue_ingest(material_id, user_id, quality)
        except Exception as exc:
            logger.warning("Queue enqueue failed for %s, using local fallback: %s", material_id, exc)
            await _run_ingest_local(material_id, user_id, quality)
        return

    await _run_ingest_local(material_id, user_id, quality)


async def _run_ingest_local(material_id: str, user_id: str, quality: str) -> None:
    if settings.INGEST_AWAIT:
        result = await ingest_material_resilient(material_id, user_id, quality)
        if not result.get("ok"):
            logger.error("Ingest failed for %s: %s", material_id, result.get("error"))
        return
    task = asyncio.create_task(ingest_material_resilient(material_id, user_id, quality))
    task.add_done_callback(_ingest_background_done)


def _course_to_dict(c: Course) -> dict:
    return {
        "id": c.id,
        "courseCode": c.course_code,
        "courseName": c.course_name,
        "courseType": c.course_type,
        "category": c.category,
        "level": c.level,
        "thumbnail": c.thumbnail,
        "duration": c.duration,
        "rating": c.rating,
        "studentCount": c.student_count,
        "createdAt": c.created_at.isoformat(),
    }


_PY_WEEKDAY_TO_DOW: dict[int, object] = {}  # populated lazily after enums import


def _topic_to_dict(t: Topic) -> dict:
    return {
        "id": t.id,
        "courseId": t.course_id,
        "title": t.title,
        "description": t.description,
        "weekNumber": t.week_number,
        "sessionDate": t.session_date.isoformat() if t.session_date else None,
        "orderIndex": t.order_index,
        "status": t.status,
        "createdAt": t.created_at.isoformat(),
        "isPersonal": t.is_personal,
        "createdBy": t.created_by,
    }


_PY_DOW_MAP: dict[int, DayOfWeek] = {
    0: DayOfWeek.MON, 1: DayOfWeek.TUE, 2: DayOfWeek.WED,
    3: DayOfWeek.THU, 4: DayOfWeek.FRI, 5: DayOfWeek.SAT, 6: DayOfWeek.SUN,
}


async def _auto_mark_attendance(db: AsyncSession, user_id: str, course_id: str) -> None:
    """Called when a student adds a personal topic. If the course has a class
    scheduled today in the student's OWN timezone, upserts an AttendanceRecord.
    The unique constraint on (userId, slotId, date) guarantees a student adding
    multiple topics in one session still counts as exactly ONE class attended.

    Uses the student's timezone so a student in UTC+6 logging at 00:30 local
    Monday correctly matches Monday's slot, not Sunday's UTC slot.
    """
    user = await db.get(User, user_id)
    if not user:
        return

    tz = user_timezone(user)
    local_now = datetime.now(timezone.utc).astimezone(tz)
    local_today = local_now.date()
    today_dow = _PY_DOW_MAP[local_today.weekday()]
    # Store attendance date as midnight UTC of the user's local date so it aligns
    # with what the post-class worker writes (also local-date midnight UTC).
    attendance_dt = datetime.combine(local_today, time.min, tzinfo=timezone.utc)

    slot = (await db.execute(
        select(ScheduleSlot).where(
            ScheduleSlot.course_id == course_id,
            ScheduleSlot.day_of_week == today_dow,
        )
    )).scalar_one_or_none()

    if not slot:
        return  # No class scheduled today for this course

    existing = (await db.execute(
        select(AttendanceRecord).where(
            AttendanceRecord.user_id == user_id,
            AttendanceRecord.slot_id == slot.id,
            AttendanceRecord.date == attendance_dt,
        )
    )).scalar_one_or_none()

    if not existing:
        db.add(AttendanceRecord(
            user_id=user_id,
            slot_id=slot.id,
            date=attendance_dt,
            present=True,
        ))

    # Resolve any pending post-class attendance-prompt notifications for this slot
    # so the student doesn't see a stale "I attended / I missed class" prompt, and
    # the 11 PM follow-up worker skips this student tonight.
    pending_notifs = (await db.execute(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.type.in_([NotificationType.CLASS_REMINDER, NotificationType.LAB_REMINDER]),
        )
    )).scalars().all()
    today_iso = local_today.isoformat()
    for notif in pending_notifs:
        meta = notif.metadata_ or {}
        if (
            meta.get("attendancePrompt")
            and meta.get("slotId") == slot.id
            and meta.get("reminderDate") == today_iso
            and not meta.get("resolved")
            and not meta.get("classResponse")
        ):
            notif.metadata_ = {**meta, "resolved": True, "autoResolved": True}
            notif.is_read = True


def _material_to_dict(m: Material) -> dict:
    return {
        "id": m.id,
        "topicId": m.topic_id,
        "title": m.title,
        "fileUrl": m.file_url,
        "fileType": m.file_type,
        "publicId": m.public_id,
        "uploadedAt": m.uploaded_at.isoformat(),
        "hasEmbeddings": m.has_embeddings,
        "ingestStatus": m.ingest_status,
        "ingestError": (m.ingest_error[:200] + "…") if m.ingest_error and len(m.ingest_error) > 200 else m.ingest_error,
        "chunkCount": m.chunk_count,
        "ocrQuality": m.ocr_quality,
    }


def _infer_material_type(original_filename: str, file_type: str | None) -> MaterialType:
    if file_type and file_type.upper() in MaterialType.__members__:
        return MaterialType(file_type.upper())

    lower_name = original_filename.lower()
    if lower_name.endswith(".txt"):
        return MaterialType.NOTE
    if lower_name.endswith((".jpg", ".jpeg", ".png", ".webp")):
        return MaterialType.IMAGE
    return MaterialType.PDF


async def _require_course(db: AsyncSession, course_id: str) -> Course:
    course = await db.get(Course, course_id)
    if not course:
        raise NotFoundError("Course not found")
    return course


async def _require_topic(db: AsyncSession, course_id: str, topic_id: str) -> Topic:
    topic = await db.get(Topic, topic_id)
    if not topic or topic.course_id != course_id:
        raise NotFoundError("Topic not found")
    return topic


async def _require_material(db: AsyncSession, topic_id: str, material_id: str) -> Material:
    material = await db.get(Material, material_id)
    if not material or material.topic_id != topic_id:
        raise NotFoundError("Material not found")
    return material


async def _require_course_manager(db: AsyncSession, course_id: str, user_id: str) -> None:
    user = await db.get(User, user_id)
    if not user:
        raise NotFoundError("User not found")
    await ensure_classroom_owner_for_course_or_admin(db, user, course_id)


async def _is_course_material_editor(db: AsyncSession, course_id: str, user_id: str) -> bool:
    """True if admin or the classroom *owner* tutor (can edit shared topics/materials)."""
    user = await db.get(User, user_id)
    if not user:
        return False
    return await is_classroom_owner_for_course(db, user, course_id)


async def _require_topic_student_owner_or_editor(
    db: AsyncSession, course_id: str, topic_id: str, user_id: str
) -> Topic:
    """Classroom owner or admin: shared topics. Enrolled student: only personal topics they created."""
    topic = await _require_topic(db, course_id, topic_id)
    if await _is_course_material_editor(db, course_id, user_id):
        return topic
    user = await db.get(User, user_id)
    if user and user.role == Role.TUTOR:
        raise ForbiddenError(
            "Only the instructor who created the classroom for this course can edit the shared class schedule. "
            "Co-tutors should add materials from the classroom."
        )
    if not user or user.role != Role.STUDENT:
        raise ForbiddenError("You don't have permission to change this topic or its materials.")
    enr = (
        await db.execute(
            select(Enrollment.id).where(
                Enrollment.user_id == user_id,
                Enrollment.course_id == course_id,
            )
        )
    ).scalar_one_or_none()
    if not enr:
        raise ForbiddenError("You are not enrolled in this course.")
    if topic.is_personal and topic.created_by == user_id:
        return topic
    raise ForbiddenError(
        "You can only add or edit materials on your own study topics. "
        'Use "Add Topic" or "Log Topic" to create one, then upload files there.'
    )


async def _require_reingest_access(db: AsyncSession, course_id: str, user_id: str) -> None:
    """Who may re-trigger RAG indexing: same audience as AI Tutor (students + tutors) + admins.

    Intentionally not tied to enrollment or classroom tutor rows — Ask Course / course detail
    are already available to these roles without extra course-level gates.
    """
    user = await db.get(User, user_id)
    if not user:
        raise NotFoundError("User not found")
    if user.role == Role.ADMIN:
        return
    if user.role not in (Role.STUDENT, Role.TUTOR):
        raise ForbiddenError("Re-index is only available to students and tutors")
    course = await db.get(Course, course_id)
    if not course:
        raise NotFoundError("Course not found")


async def _teaching_context(db: AsyncSession, course_id: str, user_id: str | None) -> dict:
    context = {
        "isTeaching": False,
        "canManage": False,
        "communityId": None,
        "communityName": None,
        "viewerRole": "STUDENT",
    }
    if not user_id:
        return context

    user = await db.get(User, user_id)
    if not user:
        return context

    if user.role == Role.ADMIN:
        community = (
            await db.execute(
                select(Community).where(Community.course_id == course_id).order_by(Community.created_at.asc())
            )
        ).scalar_one_or_none()
        return {
            "isTeaching": True,
            "canManage": True,
            "communityId": community.id if community else None,
            "communityName": community.name if community else None,
            "viewerRole": "ADMIN",
        }

    community = (
        await db.execute(
            select(Community)
            .where(Community.course_id == course_id, Community.created_by == user_id)
            .order_by(Community.created_at.asc())
        )
    ).scalar_one_or_none()
    if community:
        return {
            "isTeaching": True,
            "canManage": True,
            "communityId": community.id,
            "communityName": community.name,
            "viewerRole": "TUTOR",
        }

    member_row = (
        await db.execute(
            select(Community.id, Community.name, CommunityMember.role)
            .join(CommunityMember, CommunityMember.community_id == Community.id)
            .where(Community.course_id == course_id, CommunityMember.user_id == user_id)
            .order_by(Community.created_at.asc())
        )
    ).first()
    if not member_row:
        return context

    community_id, community_name, community_role = member_row
    comm = await db.get(Community, community_id)
    is_tutor = community_role == CommunityRole.TUTOR
    is_classroom_owner = bool(comm and comm.created_by == user_id)
    return {
        "isTeaching": is_tutor,
        "canManage": is_classroom_owner and is_tutor,
        "communityId": community_id,
        "communityName": community_name,
        "viewerRole": "TUTOR" if is_tutor else "STUDENT",
    }


async def _student_count_by_course(db: AsyncSession, course_ids: list[str]) -> dict[str, int]:
    if not course_ids:
        return {}
    rows = (
        await db.execute(
            select(Enrollment.course_id, func.count(Enrollment.id))
            .join(User, User.id == Enrollment.user_id)
            .where(Enrollment.course_id.in_(course_ids), User.role == Role.STUDENT)
            .group_by(Enrollment.course_id)
        )
    ).all()
    return {course_id: int(count) for course_id, count in rows}


async def _material_count_by_course(db: AsyncSession, course_ids: list[str]) -> dict[str, int]:
    if not course_ids:
        return {}
    rows = (
        await db.execute(
            select(Topic.course_id, func.count(Material.id))
            .join(Material, Material.topic_id == Topic.id)
            .where(Topic.course_id.in_(course_ids))
            .group_by(Topic.course_id)
        )
    ).all()
    return {course_id: int(count) for course_id, count in rows}


async def _notify_course_students(
    db: AsyncSession,
    course_id: str,
    *,
    title: str,
    body: str,
    notification_key_prefix: str,
    metadata: dict,
) -> None:
    student_ids = (
        await db.execute(
            select(Enrollment.user_id)
            .join(User, User.id == Enrollment.user_id)
            .where(Enrollment.course_id == course_id, User.role == Role.STUDENT)
        )
    ).scalars().all()
    for student_id in student_ids:
        await notification_service.create_notification(
            db=db,
            user_id=student_id,
            type=NotificationType.MATERIAL_UPLOAD_PROMPT,
            title=title,
            body=body,
            metadata={**metadata, "notificationKey": f"{notification_key_prefix}:{student_id}"},
        )


# ── Courses ───────────────────────────────────────────────────────────────────

async def list_courses(db: AsyncSession, q: CoursesQuery) -> tuple[list[dict], int]:
    stmt = select(Course)

    if q.search:
        stmt = stmt.where(or_(
            Course.course_name.ilike(f"%{q.search}%"),
            Course.course_code.ilike(f"%{q.search}%"),
        ))
    if q.level and q.level != "All":
        stmt = stmt.where(Course.level == q.level)
    if q.category and q.category != "All":
        stmt = stmt.where(Course.category == q.category)

    if q.sort == "az":
        stmt = stmt.order_by(Course.course_name.asc())
    elif q.sort == "za":
        stmt = stmt.order_by(Course.course_name.desc())
    elif q.sort == "popular":
        stmt = stmt.order_by(Course.student_count.desc())
    else:
        stmt = stmt.order_by(Course.created_at.desc())

    count_result = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total: int = count_result.scalar_one()

    stmt = stmt.offset((q.page - 1) * q.limit).limit(q.limit)
    result = await db.execute(stmt)
    courses = result.scalars().all()
    return [_course_to_dict(c) for c in courses], total


async def my_courses(db: AsyncSession, user_id: str) -> list[dict]:
    # Single query: enroll + course + topic aggregates
    stmt = (
        select(
            Enrollment,
            Course,
            func.count(Topic.id).label("total_topics"),
            func.sum(case((Topic.status == TopicStatus.DONE, 1), else_=0)).label("done_topics"),
        )
        .join(Course, Enrollment.course_id == Course.id)
        .outerjoin(Topic, Topic.course_id == Course.id)
        .where(Enrollment.user_id == user_id)
        .group_by(Enrollment.id, Course.id)
    )
    result = await db.execute(stmt)
    rows = result.all()
    course_ids = [course.id for _, course, _, _ in rows]
    student_count_map = await _student_count_by_course(db, course_ids)
    material_count_map = await _material_count_by_course(db, course_ids)

    teaching_map: dict[str, dict] = {}
    created_rows = (
        await db.execute(
            select(Community.course_id, Community.id, Community.name)
            .where(Community.course_id.in_(course_ids), Community.created_by == user_id)
        )
    ).all()
    for course_id, community_id, community_name in created_rows:
        teaching_map[course_id] = {"communityId": community_id, "communityName": community_name}

    tutor_rows = (
        await db.execute(
            select(Community.course_id, Community.id, Community.name)
            .join(CommunityMember, CommunityMember.community_id == Community.id)
            .where(
                Community.course_id.in_(course_ids),
                CommunityMember.user_id == user_id,
                CommunityMember.role == CommunityRole.TUTOR,
            )
        )
    ).all()
    for course_id, community_id, community_name in tutor_rows:
        teaching_map.setdefault(course_id, {"communityId": community_id, "communityName": community_name})

    courses = []
    for enrollment, course, total, done in rows:
        total = total or 0
        done = done or 0
        teaching = teaching_map.get(course.id)
        courses.append({
            **_course_to_dict(course),
            "progress": round((done / total) * 100) if total > 0 else 0,
            "completedTopics": done,
            "totalTopics": total,
            "enrollmentId": enrollment.id,
            "ctScore1": enrollment.ct_score1,
            "ctScore2": enrollment.ct_score2,
            "ctScore3": enrollment.ct_score3,
            "labScore": enrollment.lab_score,
            "isTeaching": bool(teaching),
            "communityId": teaching["communityId"] if teaching else None,
            "communityName": teaching["communityName"] if teaching else None,
            "studentCount": student_count_map.get(course.id, 0),
            "materialCount": material_count_map.get(course.id, 0),
        })

    # Tutors may manage a course via a classroom (Community) without a self-enrollment row.
    viewer = await db.get(User, user_id)
    if viewer and viewer.role in (Role.TUTOR, Role.ADMIN):
        enrolled_or_listed: set[str] = {c["id"] for c in courses}
        extra_rows = (
            await db.execute(
                select(Course, Community)
                .join(Community, Community.course_id == Course.id)
                .join(CommunityMember, CommunityMember.community_id == Community.id)
                .where(
                    CommunityMember.user_id == user_id,
                    CommunityMember.role == CommunityRole.TUTOR,
                )
            )
        ).all()
        added: set[str] = set()
        extra_ids: list[str] = []
        pair_by_course: dict[str, tuple[Course, Community]] = {}
        for crse, comm in extra_rows:
            if crse.id in enrolled_or_listed or crse.id in added:
                continue
            added.add(crse.id)
            extra_ids.append(crse.id)
            pair_by_course[crse.id] = (crse, comm)

        if extra_ids:
            s_extra = await _student_count_by_course(db, extra_ids)
            m_extra = await _material_count_by_course(db, extra_ids)
            agg = (
                await db.execute(
                    select(
                        Topic.course_id,
                        func.count(Topic.id).label("total_topics"),
                        func.sum(case((Topic.status == TopicStatus.DONE, 1), else_=0)).label("done_topics"),
                    )
                    .where(Topic.course_id.in_(extra_ids))
                    .group_by(Topic.course_id)
                )
            ).all()
            agg_by: dict[str, tuple[int, int]] = {}
            for row in agg:
                cid = str(row[0])
                tot = int(row[1] or 0)
                d = int(row[2] or 0)
                agg_by[cid] = (tot, d)

            for cid in extra_ids:
                crse, comm = pair_by_course[cid]
                total, done = agg_by.get(cid, (0, 0))
                courses.append(
                    {
                        **_course_to_dict(crse),
                        "progress": round((done / total) * 100) if total > 0 else 0,
                        "completedTopics": done,
                        "totalTopics": total,
                        "enrollmentId": None,
                        "ctScore1": None,
                        "ctScore2": None,
                        "ctScore3": None,
                        "labScore": None,
                        "isTeaching": True,
                        "communityId": comm.id,
                        "communityName": comm.name,
                        "studentCount": s_extra.get(crse.id, 0),
                        "materialCount": m_extra.get(crse.id, 0),
                    }
                )

    return courses


async def get_course_detail(db: AsyncSession, course_id: str, user_id: str | None) -> dict:
    course_result = await db.execute(select(Course).where(Course.id == course_id))
    course = course_result.scalar_one_or_none()
    if not course:
        raise NotFoundError("Course not found")

    # Shared topics: is_personal=False → visible to all
    # Personal topics: is_personal=True → visible only to their creator
    if user_id:
        topic_visibility = or_(
            Topic.is_personal == False,  # noqa: E712
            and_(Topic.is_personal == True, Topic.created_by == user_id),  # noqa: E712
        )
    else:
        topic_visibility = Topic.is_personal == False  # noqa: E712

    topics_result = await db.execute(
        select(Topic)
        .where(Topic.course_id == course_id, topic_visibility)
        .order_by(Topic.order_index)
    )
    topics = topics_result.scalars().all()
    topic_ids = [t.id for t in topics]

    # Materials for all topics in one query
    materials_by_topic: dict[str, list[dict]] = {t.id: [] for t in topics}
    if topic_ids:
        mat_result = await db.execute(
            select(Material).where(Material.topic_id.in_(topic_ids)).order_by(Material.uploaded_at.asc())
        )
        for mat in mat_result.scalars().all():
            materials_by_topic[mat.topic_id].append(_material_to_dict(mat))

    # TopicProgress for current user
    progress_by_topic: dict[str, dict] = {}
    if user_id and topic_ids:
        prog_result = await db.execute(
            select(TopicProgress).where(
                TopicProgress.user_id == user_id,
                TopicProgress.topic_id.in_(topic_ids),
            )
        )
        for p in prog_result.scalars().all():
            progress_by_topic[p.topic_id] = {
                "expertiseLevel": p.expertise_level,
                "studyMinutes": p.study_minutes,
                "examScore": p.exam_score,
                "lastStudied": p.last_studied.isoformat() if p.last_studied else None,
            }

    topics_data = []
    for t in topics:
        topic_dict = _topic_to_dict(t)
        topic_dict["materials"] = materials_by_topic.get(t.id, [])
        topic_dict["topicProgress"] = [progress_by_topic[t.id]] if t.id in progress_by_topic else []
        topics_data.append(topic_dict)

    # Enrollment count
    count_result = await db.execute(
        select(func.count(Enrollment.id)).where(Enrollment.course_id == course_id)
    )
    enrollment_count = count_result.scalar_one()
    student_count = (
        await db.execute(
            select(func.count(Enrollment.id))
            .join(User, User.id == Enrollment.user_id)
            .where(Enrollment.course_id == course_id, User.role == Role.STUDENT)
        )
    ).scalar_one()

    # User's own enrollment
    enrollment = None
    if user_id:
        enr_result = await db.execute(
            select(Enrollment).where(
                Enrollment.course_id == course_id,
                Enrollment.user_id == user_id,
            )
        )
        enr = enr_result.scalar_one_or_none()
        if enr:
            enrollment = {
                "id": enr.id,
                "ctScore1": enr.ct_score1,
                "ctScore2": enr.ct_score2,
                "ctScore3": enr.ct_score3,
                "labScore": enr.lab_score,
            }

    teaching_context = await _teaching_context(db, course_id, user_id)
    material_count = sum(len(topic["materials"]) for topic in topics_data)

    # Today's attendance status for the current student — use their own timezone
    # so the "today" slot matches what the worker and study-log code use.
    today_attendance: dict | None = None
    if user_id and enrollment:
        viewer = await db.get(User, user_id)
        tz = user_timezone(viewer)
        local_now = datetime.now(timezone.utc).astimezone(tz)
        local_today = local_now.date()
        today_dow = _PY_DOW_MAP[local_today.weekday()]
        today_slot = (await db.execute(
            select(ScheduleSlot).where(
                ScheduleSlot.course_id == course_id,
                ScheduleSlot.day_of_week == today_dow,
            )
        )).scalar_one_or_none()

        if today_slot:
            attendance_dt = datetime.combine(local_today, time.min, tzinfo=timezone.utc)
            att_rec = (await db.execute(
                select(AttendanceRecord).where(
                    AttendanceRecord.user_id == user_id,
                    AttendanceRecord.slot_id == today_slot.id,
                    AttendanceRecord.date == attendance_dt,
                )
            )).scalar_one_or_none()
            today_attendance = {
                "slotId": today_slot.id,
                "startTime": today_slot.start_time,
                "endTime": today_slot.end_time,
                "room": today_slot.room,
                "isPresent": bool(att_rec and att_rec.present),
                "isMarked": att_rec is not None,
            }

    return {
        **_course_to_dict(course),
        "topics": topics_data,
        "_count": {"enrollments": enrollment_count, "students": student_count, "materials": material_count},
        "enrollment": enrollment,
        "communityId": teaching_context["communityId"],
        "communityName": teaching_context["communityName"],
        "isTeaching": teaching_context["isTeaching"],
        "canManage": teaching_context["canManage"],
        "viewerRole": teaching_context["viewerRole"],
        "todayAttendance": today_attendance,
    }


# ── Topics ────────────────────────────────────────────────────────────────────

async def create_topic(db: AsyncSession, course_id: str, body: CreateTopicRequest, user_id: str) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise NotFoundError("User not found")

    is_student_role = user.role == Role.STUDENT

    if is_student_role:
        # Students may only add personal study-log topics to courses they are enrolled in.
        enrolled = (await db.execute(
            select(Enrollment).where(
                Enrollment.user_id == user_id,
                Enrollment.course_id == course_id,
            )
        )).scalar_one_or_none()
        if not enrolled:
            raise ForbiddenError("You are not enrolled in this course")
    else:
        # Tutors/Admins: check they actually manage this course.
        await _require_course_manager(db, course_id, user_id)

    await _require_course(db, course_id)

    # Get next orderIndex
    max_result = await db.execute(
        select(func.max(Topic.order_index)).where(Topic.course_id == course_id)
    )
    max_order = max_result.scalar_one_or_none() or -1
    order_index = body.orderIndex if body.orderIndex is not None else max_order + 1

    topic = Topic(
        course_id=course_id,
        title=body.title,
        description=body.description,
        week_number=body.weekNumber,
        session_date=body.sessionDate or datetime.now(timezone.utc),
        order_index=order_index,
        status=body.status,
        is_personal=is_student_role,
        created_by=user_id if is_student_role else None,
    )
    db.add(topic)

    # For students: auto-mark attendance if there is a class scheduled today.
    # Adding multiple topics on the same day still counts as ONE attendance because
    # the UniqueConstraint(userId, slotId, date) on AttendanceRecord prevents duplicates.
    if is_student_role:
        await _auto_mark_attendance(db, user_id, course_id)

    await db.commit()
    await db.refresh(topic)

    result = _topic_to_dict(topic)
    result["materials"] = []
    return result


async def update_topic(db: AsyncSession, course_id: str, topic_id: str, body: UpdateTopicRequest, user_id: str) -> dict:
    topic = await _require_topic_student_owner_or_editor(db, course_id, topic_id, user_id)

    updates = body.model_dump(exclude_unset=True)
    if "weekNumber" in updates:
        topic.week_number = updates.pop("weekNumber")
    if "sessionDate" in updates:
        topic.session_date = updates.pop("sessionDate")
    if "orderIndex" in updates:
        topic.order_index = updates.pop("orderIndex")
    for k, v in updates.items():
        setattr(topic, k, v)

    await db.commit()
    await db.refresh(topic)

    mat_result = await db.execute(
        select(Material).where(Material.topic_id == topic_id).order_by(Material.uploaded_at.asc())
    )
    materials = [_material_to_dict(m) for m in mat_result.scalars().all()]

    result_dict = _topic_to_dict(topic)
    result_dict["materials"] = materials
    return result_dict


async def delete_topic(db: AsyncSession, topic_id: str) -> None:
    result = await db.execute(select(Topic).where(Topic.id == topic_id))
    topic = result.scalar_one_or_none()
    if not topic:
        raise NotFoundError("Topic not found")

    materials = (
        await db.execute(select(Material).where(Material.topic_id == topic_id))
    ).scalars().all()
    for material in materials:
        if material.public_id:
            try:
                await cloudinary_service.delete_file(material.public_id)
            except Exception:
                logger.warning("Cloudinary delete failed for %s", material.public_id)
    await db.delete(topic)
    await db.commit()


async def delete_topic_for_course(db: AsyncSession, course_id: str, topic_id: str, user_id: str) -> None:
    await _require_topic_student_owner_or_editor(db, course_id, topic_id, user_id)
    await delete_topic(db, topic_id)


async def reorder_topics(db: AsyncSession, course_id: str, body: ReorderTopicsRequest, user_id: str) -> None:
    await _require_course_manager(db, course_id, user_id)
    for index, topic_id in enumerate(body.topicIds):
        await db.execute(
            update(Topic).where(Topic.id == topic_id).values(order_index=index)
        )
    await db.commit()


# ── Materials ─────────────────────────────────────────────────────────────────

async def upload_material(
    db: AsyncSession,
    course_id: str,
    topic_id: str,
    user_id: str,
    file_bytes: bytes,
    original_filename: str,
    title: str | None,
    file_type: str | None,
    quality: str | None,
) -> dict:
    topic = await _require_topic_student_owner_or_editor(db, course_id, topic_id, user_id)
    course = await _require_course(db, course_id)
    teaching_context = await _teaching_context(db, course_id, user_id)

    upload_result = await cloudinary_service.upload_file(file_bytes, f"materials/{course_id}")

    ocr_quality = OcrQuality.ACCURATE if quality == "accurate" else OcrQuality.FAST
    mat_type = _infer_material_type(original_filename, file_type)

    material = Material(
        topic_id=topic_id,
        title=title or original_filename,
        file_url=upload_result["secure_url"],
        file_type=mat_type,
        public_id=upload_result["public_id"],
        ocr_quality=ocr_quality,
    )
    db.add(material)
    await db.flush()
    await db.refresh(material)
    new_material_id = material.id
    new_material_title = material.title or original_filename

    # Commit before background RAG ingest: ingest uses a separate session and must see this row.
    await db.commit()

    if mat_type != MaterialType.LINK:
        await _schedule_material_ingest(new_material_id, user_id, quality or "fast")

    # Notifications (second transaction) — topic/course may be expired after the first commit.
    topic = await db.get(Topic, topic_id)
    course = await db.get(Course, course_id)
    material = await db.get(Material, new_material_id)
    if not material or not course or not topic:
        raise NotFoundError("Material not found after upload")

    if not topic.is_personal:
        await _notify_course_students(
            db,
            course_id,
            title=f"New material in {course.course_code}",
            body=f"{new_material_title} was added under {topic.title if topic else 'this course'}.",
            notification_key_prefix=f"material_upload:{new_material_id}",
            metadata={
                "kind": "COURSE_MATERIAL_UPLOADED",
                "courseId": course_id,
                "courseCode": course.course_code,
                "topicId": topic_id,
                "materialId": new_material_id,
                "communityId": teaching_context["communityId"],
                "deepLink": f"/courses/{course_id}",
            },
        )

    await db.commit()
    await db.refresh(material)

    return _material_to_dict(material)


async def add_material_link(
    db: AsyncSession,
    course_id: str,
    topic_id: str,
    body: AddMaterialLinkRequest,
    user_id: str,
) -> dict:
    topic = await _require_topic_student_owner_or_editor(db, course_id, topic_id, user_id)
    course = await _require_course(db, course_id)
    teaching_context = await _teaching_context(db, course_id, user_id)

    material = Material(
        topic_id=topic_id,
        title=body.title,
        file_url=body.fileUrl,
        file_type=MaterialType.LINK,
    )
    db.add(material)
    await db.flush()
    await db.refresh(material)

    if not topic.is_personal:
        await _notify_course_students(
            db,
            course_id,
            title=f"New material in {course.course_code}",
            body=f"{material.title} was added under {topic.title if topic else 'this course'}.",
            notification_key_prefix=f"material_upload:{material.id}",
            metadata={
                "kind": "COURSE_MATERIAL_UPLOADED",
                "courseId": course_id,
                "courseCode": course.course_code,
                "topicId": topic_id,
                "materialId": material.id,
                "communityId": teaching_context["communityId"],
                "deepLink": f"/courses/{course_id}",
            },
        )
    await db.commit()
    await db.refresh(material)
    return _material_to_dict(material)


async def update_material(
    db: AsyncSession,
    course_id: str,
    topic_id: str,
    material_id: str,
    body: UpdateMaterialRequest,
    user_id: str,
) -> dict:
    await _require_topic_student_owner_or_editor(db, course_id, topic_id, user_id)
    material = await _require_material(db, topic_id, material_id)

    if body.title is not None:
        material.title = body.title

    if body.fileUrl is not None:
        if material.file_type != MaterialType.LINK:
            raise ValidationError("Only link materials can update the file URL")
        material.file_url = body.fileUrl

    await db.commit()
    await db.refresh(material)
    return _material_to_dict(material)


async def delete_material(db: AsyncSession, topic_id: str, material_id: str) -> None:
    material = await _require_material(db, topic_id, material_id)

    if material.public_id:
        try:
            await cloudinary_service.delete_file(material.public_id)
        except Exception:
            logger.warning("Cloudinary delete failed for %s", material.public_id)

    await db.delete(material)
    await db.commit()


async def delete_material_for_course(
    db: AsyncSession,
    course_id: str,
    topic_id: str,
    material_id: str,
    user_id: str,
) -> None:
    await _require_topic_student_owner_or_editor(db, course_id, topic_id, user_id)
    await delete_material(db, topic_id, material_id)


async def reingest_material(
    db: AsyncSession,
    course_id: str,
    topic_id: str,
    material_id: str,
    user_id: str,
) -> dict:
    await _require_reingest_access(db, course_id, user_id)

    topic = await db.get(Topic, topic_id)
    if not topic or topic.course_id != course_id:
        raise NotFoundError("Topic not found")

    material = await db.get(Material, material_id)
    if not material or material.topic_id != topic_id:
        raise NotFoundError("Material not found")

    if material.file_type == MaterialType.LINK:
        raise ValidationError("Link materials cannot be re-indexed")

    await db.execute(
        update(Material)
        .where(Material.id == material_id)
        .values(
            ingest_status=IngestStatus.PENDING,
            ingest_error=None,
            has_embeddings=False,
            chunk_count=0,
        )
    )
    await db.commit()
    await db.refresh(material)

    quality = "accurate" if material.ocr_quality == OcrQuality.ACCURATE else "fast"
    await _schedule_material_ingest(material_id, user_id, quality)

    return _material_to_dict(material)
