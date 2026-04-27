from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from app.core import response as resp
from app.core.deps import CurrentUserIdDep, DBDep, StudentUserIdDep, get_current_user_id, require_role
from app.core.exceptions import ValidationError
from app.core.rate_limit import limiter
from app.models.enums import Role
from app.schemas.courses import (
    AddMaterialLinkRequest,
    CoursesQuery,
    CreateTopicRequest,
    PatchMyLabMarksBody,
    PatchMyTheoryMarksBody,
    ReorderTopicsRequest,
    UpdateMaterialRequest,
    UpdateTopicRequest,
)
from app.services import courses_service

router = APIRouter(dependencies=[Depends(get_current_user_id)])

_ACCEPTED_MATERIAL_CONTENT_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/jpg",
    "text/plain",
}
_ACCEPTED_MATERIAL_EXTENSIONS = {".pdf", ".docx", ".jpg", ".jpeg", ".png", ".webp", ".txt"}
_MAX_MATERIAL_BYTES = 25 * 1024 * 1024
_SUPPORTED_MATERIAL_FORMATS_LABEL = "PDF, DOCX, JPG, JPEG, PNG, WEBP, TXT"


@router.get("")
async def list_courses(db: DBDep, query: CoursesQuery = Depends()) -> JSONResponse:
    courses, total = await courses_service.list_courses(db, query)
    return resp.success(courses, meta={"page": query.page, "limit": query.limit, "total": total})


@router.get("/my-courses")
async def my_courses(db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    courses = await courses_service.my_courses(db, user_id)
    return resp.success(courses)


# ── Topics — reorder MUST come before /{topic_id} to avoid path collision ────

@router.put("/{course_id}/topics/reorder")
async def reorder_topics(
    course_id: str, body: ReorderTopicsRequest, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
) -> JSONResponse:
    await courses_service.reorder_topics(db, course_id, body, user_id)
    return resp.success({"message": "Topics reordered"})


@router.get("/{course_id}")
async def get_course_detail(course_id: str, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    data = await courses_service.get_course_detail(db, course_id, user_id)
    return resp.success(data)


@router.patch("/{course_id}/my-lab-marks")
async def patch_my_lab_marks(
    course_id: str,
    body: PatchMyLabMarksBody,
    db: DBDep,
    student_id: StudentUserIdDep,
) -> JSONResponse:
    data = await courses_service.patch_my_lab_marks(db, course_id, student_id, body)
    return resp.success(data)


@router.patch("/{course_id}/my-theory-marks")
async def patch_my_theory_marks(
    course_id: str,
    body: PatchMyTheoryMarksBody,
    db: DBDep,
    student_id: StudentUserIdDep,
) -> JSONResponse:
    data = await courses_service.patch_my_theory_marks(db, course_id, student_id, body)
    return resp.success(data)


@router.post("/{course_id}/topics")
async def create_topic(
    course_id: str, body: CreateTopicRequest, db: DBDep, user_id: CurrentUserIdDep,
) -> JSONResponse:
    # Role-based logic is handled in the service:
    # - STUDENT → personal topic if enrolled (does not touch attendance)
    # - TUTOR/ADMIN → shared topic (requires course-manager permission)
    topic = await courses_service.create_topic(db, course_id, body, user_id)
    return resp.created(topic)


@router.put("/{course_id}/topics/{topic_id}")
async def update_topic(
    course_id: str, topic_id: str, body: UpdateTopicRequest, db: DBDep, user_id: CurrentUserIdDep,
) -> JSONResponse:
    # RBAC: tutors/admins (any topic) or enrolled students (own personal topics only) — see service
    topic = await courses_service.update_topic(db, course_id, topic_id, body, user_id)
    return resp.success(topic)


@router.delete("/{course_id}/topics/{topic_id}")
async def delete_topic(
    course_id: str, topic_id: str, db: DBDep, user_id: CurrentUserIdDep,
) -> JSONResponse:
    await courses_service.delete_topic_for_course(db, course_id, topic_id, user_id)
    return resp.success({"message": "Topic deleted"})


# ── Materials ─────────────────────────────────────────────────────────────────

@router.post("/{course_id}/topics/{topic_id}/materials")
@limiter.limit("20/hour")
async def upload_material(
    request: Request,
    course_id: str,
    topic_id: str,
    db: DBDep,
    user_id: CurrentUserIdDep,
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    fileType: str | None = Form(default=None),
    quality: str | None = Form(default=None),
) -> JSONResponse:
    # RBAC: tutors/admins or enrolled students on their own personal topics — see service
    file_ext = Path(file.filename or "").suffix.lower()
    content_type_ok = file.content_type in _ACCEPTED_MATERIAL_CONTENT_TYPES
    extension_ok = file_ext in _ACCEPTED_MATERIAL_EXTENSIONS
    if not content_type_ok and not extension_ok:
        raise ValidationError(f"Unsupported material file type. Supported formats: {_SUPPORTED_MATERIAL_FORMATS_LABEL}.")

    file_bytes = await file.read()
    if not file_bytes:
        raise ValidationError("Uploaded material is empty.")
    if len(file_bytes) > _MAX_MATERIAL_BYTES:
        raise ValidationError("Material file is too large. Max allowed size is 25MB.")

    material = await courses_service.upload_material(
        db, course_id, topic_id, user_id,
        file_bytes, file.filename or "upload",
        title, fileType, quality,
    )
    return resp.created(material)


@router.post("/{course_id}/topics/{topic_id}/materials/link")
async def add_material_link(
    course_id: str, topic_id: str, body: AddMaterialLinkRequest, db: DBDep, user_id: CurrentUserIdDep,
) -> JSONResponse:
    material = await courses_service.add_material_link(db, course_id, topic_id, body, user_id)
    return resp.created(material)


@router.delete("/{course_id}/topics/{topic_id}/materials/{material_id}")
async def delete_material(
    course_id: str, topic_id: str, material_id: str, db: DBDep, user_id: CurrentUserIdDep,
) -> JSONResponse:
    await courses_service.delete_material_for_course(db, course_id, topic_id, material_id, user_id)
    return resp.success({"message": "Material deleted"})


@router.patch("/{course_id}/topics/{topic_id}/materials/{material_id}")
async def update_material(
    course_id: str,
    topic_id: str,
    material_id: str,
    body: UpdateMaterialRequest,
    db: DBDep,
    user_id: CurrentUserIdDep,
) -> JSONResponse:
    material = await courses_service.update_material(db, course_id, topic_id, material_id, body, user_id)
    return resp.success(material)


@router.post("/{course_id}/topics/{topic_id}/materials/{material_id}/reingest")
async def reingest_material(
    course_id: str,
    topic_id: str,
    material_id: str,
    db: DBDep,
    user_id: CurrentUserIdDep,
) -> JSONResponse:
    # RBAC: students + tutors + admins (matches AI Tutor audience) — see _require_reingest_access
    material = await courses_service.reingest_material(db, course_id, topic_id, material_id, user_id)
    return resp.success(material)
