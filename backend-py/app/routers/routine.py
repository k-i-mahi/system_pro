from pathlib import Path

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import JSONResponse

from app.core import response as resp
from app.core.deps import CurrentUserIdDep, DBDep, get_current_user_id
from app.core.exceptions import ValidationError
from app.core.rate_limit import limiter
from app.schemas.routine import BulkCreateCoursesRequest, MoveSlotRequest, UpdateSlotRequest
from app.services import routine_service

_ACCEPTED = {
    "image/jpeg", "image/png", "image/webp", "image/bmp", "image/gif",
    "image/jpg",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
_EXT_ACCEPTED = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".pdf", ".docx"}

router = APIRouter(dependencies=[Depends(get_current_user_id)])


@router.post("/scan")
@limiter.limit("20/hour")
async def scan_routine(
    request: Request,
    db: DBDep,
    user_id: CurrentUserIdDep,
    file: UploadFile = File(...),
) -> JSONResponse:
    file_ext = Path(file.filename or "").suffix.lower()
    content_type_ok = file.content_type in _ACCEPTED
    extension_ok = file_ext in _EXT_ACCEPTED
    if not content_type_ok and not extension_ok:
        raise ValidationError("Unsupported file type. Please upload an image, PDF, or DOCX file.")
    file_bytes = await file.read()
    data = await routine_service.scan_routine(db, user_id, file_bytes, file.filename or "upload")
    return resp.success(data)


@router.get("/")
async def get_schedule(db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    slots = await routine_service.get_schedule(db, user_id)
    return resp.success(slots)


@router.post("/courses")
async def bulk_create_courses(body: BulkCreateCoursesRequest, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    courses = await routine_service.bulk_create_courses(db, user_id, body)
    return resp.created(courses)


@router.put("/slots/{slot_id}")
async def update_slot(slot_id: str, body: UpdateSlotRequest, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    slot = await routine_service.update_slot(db, slot_id, body)
    return resp.success(slot)


@router.put("/slots/{slot_id}/move")
async def move_slot(slot_id: str, body: MoveSlotRequest, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    result = await routine_service.move_slot(db, slot_id, user_id, body)
    return resp.success(result)


@router.delete("/slots/{slot_id}")
async def delete_slot(slot_id: str, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    await routine_service.delete_slot(db, slot_id)
    return resp.success({"message": "Slot deleted"})


@router.delete("/courses/{course_id}")
async def delete_course(course_id: str, db: DBDep, user_id: CurrentUserIdDep) -> JSONResponse:
    await routine_service.delete_course(db, user_id, course_id)
    return resp.success({"message": "Course removed from routine"})
