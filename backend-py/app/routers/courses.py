from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse

from app.core import response as resp
from app.core.deps import CurrentUserIdDep, DBDep, get_current_user_id
from app.core.rate_limit import limiter
from app.schemas.courses import (
    AddMaterialLinkRequest,
    CoursesQuery,
    CreateTopicRequest,
    ReorderTopicsRequest,
    UpdateTopicRequest,
)
from app.services import courses_service

router = APIRouter(dependencies=[Depends(get_current_user_id)])


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
async def reorder_topics(course_id: str, body: ReorderTopicsRequest, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    await courses_service.reorder_topics(db, course_id, body)
    return resp.success({"message": "Topics reordered"})


@router.get("/{course_id}")
async def get_course_detail(course_id: str, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    data = await courses_service.get_course_detail(db, course_id, user_id)
    return resp.success(data)


@router.post("/{course_id}/topics")
async def create_topic(course_id: str, body: CreateTopicRequest, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    topic = await courses_service.create_topic(db, course_id, body)
    return resp.created(topic)


@router.put("/{course_id}/topics/{topic_id}")
async def update_topic(course_id: str, topic_id: str, body: UpdateTopicRequest, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    topic = await courses_service.update_topic(db, topic_id, body)
    return resp.success(topic)


@router.delete("/{course_id}/topics/{topic_id}")
async def delete_topic(course_id: str, topic_id: str, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    await courses_service.delete_topic(db, topic_id)
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
    file_bytes = await file.read()
    material = await courses_service.upload_material(
        db, course_id, topic_id, user_id,
        file_bytes, file.filename or "upload",
        title, fileType, quality,
    )
    return resp.created(material)


@router.post("/{course_id}/topics/{topic_id}/materials/link")
async def add_material_link(course_id: str, topic_id: str, body: AddMaterialLinkRequest, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    material = await courses_service.add_material_link(db, topic_id, body)
    return resp.created(material)


@router.delete("/{course_id}/topics/{topic_id}/materials/{material_id}")
async def delete_material(course_id: str, topic_id: str, material_id: str, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    await courses_service.delete_material(db, material_id)
    return resp.success({"message": "Material deleted"})
