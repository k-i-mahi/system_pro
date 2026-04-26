from __future__ import annotations

from pydantic import BaseModel
from fastapi import APIRouter
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.deps import DBDep, RedisDep, require_role
from app.core.response import success
from app.models.enums import Role
from app.services import google_classroom_service

router = APIRouter()


class ImportAssignmentRequest(BaseModel):
    googleCourseId: str
    googleCourseName: str
    assignmentTitle: str
    dueAt: str


@router.get("/status")
async def status(redis: RedisDep, user_id: str = require_role(Role.STUDENT)):
    data = await google_classroom_service.connection_status(redis, user_id)
    return success(data)


@router.get("/connect-url")
async def connect_url(redis: RedisDep, user_id: str = require_role(Role.STUDENT)):
    url = await google_classroom_service.create_connect_url(redis, user_id)
    return success({"url": url})


@router.get("/callback", include_in_schema=False)
async def callback(
    db: DBDep,
    redis: RedisDep,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    if error or not code or not state:
        return RedirectResponse(
            url=f"{settings.FRONTEND_URL.rstrip('/')}/settings?tab=integrations&googleClassroom=error",
            status_code=302,
        )
    redirect_to = await google_classroom_service.handle_callback(db, redis, code, state)
    return RedirectResponse(url=redirect_to, status_code=302)


@router.get("/courses")
async def courses(redis: RedisDep, user_id: str = require_role(Role.STUDENT)):
    items = await google_classroom_service.list_classrooms(redis, user_id)
    return success(items)


@router.get("/courses/{course_id}/assignments")
async def assignments(course_id: str, redis: RedisDep, user_id: str = require_role(Role.STUDENT)):
    items = await google_classroom_service.list_assignments(redis, user_id, course_id)
    return success(items)


@router.delete("/disconnect")
async def disconnect(redis: RedisDep, user_id: str = require_role(Role.STUDENT)):
    await google_classroom_service.disconnect(redis, user_id)
    return success({"message": "Google Classroom disconnected"})


@router.post("/import-assignment")
async def import_assignment(body: ImportAssignmentRequest, db: DBDep, user_id: str = require_role(Role.STUDENT)):
    data = await google_classroom_service.import_assignment_to_routine(
        db,
        user_id,
        google_course_id=body.googleCourseId,
        google_course_name=body.googleCourseName,
        assignment_title=body.assignmentTitle,
        due_at=body.dueAt,
    )
    return success(data)
