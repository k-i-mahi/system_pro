from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy import case, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError
from app.models.course import Course, Enrollment, Material, ScheduleSlot, Topic, TopicProgress
from app.models.enums import IngestStatus, MaterialType, OcrQuality, TopicStatus
from app.schemas.courses import (
    AddMaterialLinkRequest,
    CoursesQuery,
    CreateTopicRequest,
    ReorderTopicsRequest,
    UpdateTopicRequest,
)
from app.services import cloudinary_service
from app.workers.queues import enqueue_ingest

logger = logging.getLogger(__name__)


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
    }


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
        "chunkCount": m.chunk_count,
        "ocrQuality": m.ocr_quality,
    }


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

    courses = []
    for enrollment, course, total, done in rows:
        total = total or 0
        done = done or 0
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
        })
    return courses


async def get_course_detail(db: AsyncSession, course_id: str, user_id: str | None) -> dict:
    course_result = await db.execute(select(Course).where(Course.id == course_id))
    course = course_result.scalar_one_or_none()
    if not course:
        raise NotFoundError("Course not found")

    # Topics ordered by orderIndex
    topics_result = await db.execute(
        select(Topic).where(Topic.course_id == course_id).order_by(Topic.order_index)
    )
    topics = topics_result.scalars().all()
    topic_ids = [t.id for t in topics]

    # Materials for all topics in one query
    materials_by_topic: dict[str, list[dict]] = {t.id: [] for t in topics}
    if topic_ids:
        mat_result = await db.execute(select(Material).where(Material.topic_id.in_(topic_ids)))
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

    return {
        **_course_to_dict(course),
        "topics": topics_data,
        "_count": {"enrollments": enrollment_count},
        "enrollment": enrollment,
    }


# ── Topics ────────────────────────────────────────────────────────────────────

async def create_topic(db: AsyncSession, course_id: str, body: CreateTopicRequest) -> dict:
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
        session_date=body.sessionDate,
        order_index=order_index,
        status=body.status,
    )
    db.add(topic)
    await db.commit()
    await db.refresh(topic)

    result = _topic_to_dict(topic)
    result["materials"] = []
    return result


async def update_topic(db: AsyncSession, topic_id: str, body: UpdateTopicRequest) -> dict:
    result = await db.execute(select(Topic).where(Topic.id == topic_id))
    topic = result.scalar_one_or_none()
    if not topic:
        raise NotFoundError("Topic not found")

    updates = body.model_dump(exclude_none=True)
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

    mat_result = await db.execute(select(Material).where(Material.topic_id == topic_id))
    materials = [_material_to_dict(m) for m in mat_result.scalars().all()]

    result_dict = _topic_to_dict(topic)
    result_dict["materials"] = materials
    return result_dict


async def delete_topic(db: AsyncSession, topic_id: str) -> None:
    result = await db.execute(select(Topic).where(Topic.id == topic_id))
    topic = result.scalar_one_or_none()
    if not topic:
        raise NotFoundError("Topic not found")
    await db.delete(topic)
    await db.commit()


async def reorder_topics(db: AsyncSession, course_id: str, body: ReorderTopicsRequest) -> None:
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
    upload_result = await cloudinary_service.upload_file(file_bytes, f"materials/{course_id}")

    ocr_quality = OcrQuality.ACCURATE if quality == "accurate" else OcrQuality.FAST
    mat_type = MaterialType(file_type.upper()) if file_type and file_type.upper() in MaterialType.__members__ else MaterialType.PDF

    material = Material(
        topic_id=topic_id,
        title=title or original_filename,
        file_url=upload_result["secure_url"],
        file_type=mat_type,
        public_id=upload_result["public_id"],
        ocr_quality=ocr_quality,
    )
    db.add(material)
    await db.commit()
    await db.refresh(material)

    # Update topic progress (+2% expertise)
    prog_result = await db.execute(
        select(TopicProgress).where(
            TopicProgress.user_id == user_id,
            TopicProgress.topic_id == topic_id,
        )
    )
    prog = prog_result.scalar_one_or_none()
    if prog:
        prog.expertise_level = min(1.0, prog.expertise_level + 0.02)
    else:
        db.add(TopicProgress(user_id=user_id, topic_id=topic_id, expertise_level=0.02))
    await db.commit()

    # Fire-and-forget ingest (non-link materials only)
    if mat_type != MaterialType.LINK:
        try:
            await enqueue_ingest(material.id, user_id, quality or "fast")
        except Exception:
            logger.warning("Failed to enqueue ingest for material %s", material.id)

    return _material_to_dict(material)


async def add_material_link(db: AsyncSession, topic_id: str, body: AddMaterialLinkRequest) -> dict:
    material = Material(
        topic_id=topic_id,
        title=body.title,
        file_url=body.fileUrl,
        file_type=MaterialType.LINK,
    )
    db.add(material)
    await db.commit()
    await db.refresh(material)
    return _material_to_dict(material)


async def delete_material(db: AsyncSession, material_id: str) -> None:
    result = await db.execute(select(Material).where(Material.id == material_id))
    material = result.scalar_one_or_none()
    if not material:
        raise NotFoundError("Material not found")

    if material.public_id:
        try:
            await cloudinary_service.delete_file(material.public_id)
        except Exception:
            logger.warning("Cloudinary delete failed for %s", material.public_id)

    await db.delete(material)
    await db.commit()
