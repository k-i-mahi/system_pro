"""Access control and ingest readiness for course-grounded RAG (ask-course)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ForbiddenError, NotFoundError, ValidationError
from app.models.course import Course, Enrollment, Material, Topic
from app.models.enums import IngestStatus, MaterialType, Role
from app.models.user import User
from app.services.rag.retriever import RetrievalScope


async def _get_user_role(db: AsyncSession, user_id: str) -> Role:
    user = await db.get(User, user_id)
    if not user:
        raise NotFoundError("User not found")
    return user.role


async def _ensure_course_exists(db: AsyncSession, course_id: str) -> Course:
    course = await db.get(Course, course_id)
    if not course:
        raise NotFoundError("Course not found")
    return course


async def _ensure_enrolled(db: AsyncSession, user_id: str, course_id: str) -> None:
    row = (
        await db.execute(select(Enrollment.id).where(Enrollment.user_id == user_id, Enrollment.course_id == course_id))
    ).scalar_one_or_none()
    if row is None:
        raise ForbiddenError("You are not enrolled in this course")


async def ensure_user_can_rag_course(db: AsyncSession, user_id: str, course_id: str) -> None:
    await _ensure_course_exists(db, course_id)
    role = await _get_user_role(db, user_id)
    if role in (Role.TUTOR, Role.ADMIN, Role.MENTOR):
        return
    await _ensure_enrolled(db, user_id, course_id)


async def resolve_course_id_for_rag(
    db: AsyncSession,
    course_id: str | None,
    topic_id: str | None,
    material_ids: list[str] | None,
) -> str:
    """Return canonical course_id for access checks."""
    if course_id:
        return course_id
    if topic_id:
        topic = await db.get(Topic, topic_id)
        if not topic:
            raise NotFoundError("Topic not found")
        return topic.course_id
    if material_ids:
        mats = (await db.execute(select(Material).where(Material.id.in_(material_ids)))).scalars().all()
        if not mats:
            raise NotFoundError("Material not found")
        topic_ids = {m.topic_id for m in mats}
        if len(topic_ids) != 1:
            raise ValidationError("All materials must belong to the same topic", code="BAD_MATERIAL_SCOPE")
        topic = await db.get(Topic, next(iter(topic_ids)))
        if not topic:
            raise NotFoundError("Topic not found")
        return topic.course_id
    raise ValidationError("Provide courseId, topicId, or materialIds for grounded Q&A", code="MISSING_SCOPE")


async def ensure_ask_course_access(
    db: AsyncSession,
    user_id: str,
    course_id: str | None,
    topic_id: str | None,
    material_ids: list[str] | None,
) -> str:
    """
    Verify user may run RAG over the given scope. Returns resolved course_id.
    Validates material_ids belong to the resolved course when provided.
    """
    resolved_course = await resolve_course_id_for_rag(db, course_id, topic_id, material_ids)

    if topic_id:
        topic = await db.get(Topic, topic_id)
        if not topic:
            raise NotFoundError("Topic not found")
        if topic.course_id != resolved_course:
            raise ValidationError("Topic does not belong to the given course", code="TOPIC_COURSE_MISMATCH")

    if material_ids:
        mats = (await db.execute(select(Material).where(Material.id.in_(material_ids)))).scalars().all()
        if len(mats) != len(set(material_ids)):
            raise NotFoundError("One or more materials were not found")
        for m in mats:
            top = await db.get(Topic, m.topic_id)
            if not top or top.course_id != resolved_course:
                raise ForbiddenError("Material is not accessible in this course context")

    await ensure_user_can_rag_course(db, user_id, resolved_course)
    return resolved_course


async def ingest_readiness_for_scope(db: AsyncSession, scope: RetrievalScope) -> dict[str, int | list[str]]:
    """
    Count materials in retrieval scope by ingest state (non-LINK files only).
    """
    stmt = select(Material).where(Material.file_type != MaterialType.LINK)

    if scope.material_ids:
        stmt = stmt.where(Material.id.in_(scope.material_ids))
    elif scope.topic_id:
        stmt = stmt.where(Material.topic_id == scope.topic_id)
    elif scope.course_id:
        stmt = stmt.join(Topic, Material.topic_id == Topic.id).where(Topic.course_id == scope.course_id)
    else:
        return {
            "total": 0,
            "ready": 0,
            "pending": 0,
            "processing": 0,
            "failed": 0,
            "errors": [],
        }

    mats = (await db.execute(stmt)).scalars().all()
    pending = processing = failed = ready = 0
    errors: list[str] = []
    for m in mats:
        st = m.ingest_status
        if st == IngestStatus.DONE and m.has_embeddings and (m.chunk_count or 0) > 0:
            ready += 1
        elif st == IngestStatus.PENDING:
            pending += 1
        elif st == IngestStatus.PROCESSING:
            processing += 1
        elif st == IngestStatus.FAILED:
            failed += 1
            if m.ingest_error and len(errors) < 5:
                errors.append(f"{m.title}: {m.ingest_error[:120]}")
        elif st == IngestStatus.DONE and not m.has_embeddings:
            failed += 1
            if len(errors) < 5:
                errors.append(f"{m.title}: ingest finished but no embeddings")

    return {
        "total": len(mats),
        "ready": ready,
        "pending": pending,
        "processing": processing,
        "failed": failed,
        "errors": errors,
    }
