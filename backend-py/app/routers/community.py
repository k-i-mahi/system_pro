from typing import Optional

from fastapi import APIRouter, Depends, File, UploadFile

from app.core.deps import CurrentUserIdDep, DBDep, get_current_user_id, require_role
from app.core.exceptions import ValidationError
from app.core.response import created, success
from app.models.enums import Role
from app.schemas.community import (
    CreateAnnouncementRequest, CreateCommunityRequest, CreatePostRequest,
    CreateThreadRequest, JoinCommunityRequest, RecordAttendanceRequest,
)
from app.services import community_service

_ACCEPTED_SPREADSHEET = {
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
}

router = APIRouter(dependencies=[Depends(get_current_user_id)])


# ── Threads (STUDENT-only public discussion — tutors/admins use Classrooms) ──

@router.get("/threads")
async def list_threads(
    db: DBDep, user_id: CurrentUserIdDep,
    tab: Optional[str] = None, courseId: Optional[str] = None,
    tag: Optional[str] = None, page: int = 1, limit: int = 20,
    _role: str = require_role(Role.STUDENT),
):
    items, total = await community_service.list_threads(db, user_id, tab, courseId, tag, page, limit)
    return success(items, meta={"page": page, "limit": limit, "total": total})


@router.post("/threads")
async def create_thread(
    body: CreateThreadRequest, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.STUDENT),
):
    data = await community_service.create_thread(db, user_id, body.model_dump())
    return created(data)


@router.get("/threads/{thread_id}")
async def get_thread(
    thread_id: str, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.STUDENT),
):
    data = await community_service.get_thread(db, thread_id, user_id)
    return success(data)


@router.post("/threads/{thread_id}/posts")
async def create_post(
    thread_id: str, body: CreatePostRequest, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.STUDENT),
):
    data = await community_service.create_post(db, thread_id, user_id, body.content, body.fileUrl)
    return created(data)


@router.delete("/threads/{thread_id}")
async def delete_thread(
    thread_id: str, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.STUDENT),
):
    data = await community_service.delete_thread(db, thread_id, user_id)
    return success(data)


@router.post("/threads/{thread_id}/like")
async def like_thread(
    thread_id: str, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.STUDENT),
):
    data = await community_service.like_thread(db, thread_id, user_id)
    return success(data)


@router.delete("/threads/{thread_id}/like")
async def unlike_thread(
    thread_id: str, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.STUDENT),
):
    data = await community_service.unlike_thread(db, thread_id, user_id)
    return success(data)


# ── Community CRUD ────────────────────────────────────────────────────────────

@router.post("")
async def create_community(
    body: CreateCommunityRequest, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
):
    data = await community_service.create_community(db, user_id, body.model_dump())
    return created(data)


@router.get("")
async def list_communities(
    db: DBDep, user_id: CurrentUserIdDep,
    tab: Optional[str] = None, page: int = 1, limit: int = 20,
):
    items, total = await community_service.list_communities(db, user_id, tab, page, limit)
    return success(items, meta={"page": page, "limit": limit, "total": total})


@router.get("/{community_id}")
async def get_community(community_id: str, db: DBDep, user_id: CurrentUserIdDep):
    data = await community_service.get_community(db, community_id)
    return success(data)


@router.post("/{community_id}/join")
async def join_community(community_id: str, body: JoinCommunityRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await community_service.join_community(db, community_id, user_id, body.rollNumber, body.session, body.department)
    return created(data)


@router.delete("/{community_id}/leave")
async def leave_community(community_id: str, db: DBDep, user_id: CurrentUserIdDep):
    data = await community_service.leave_community(db, community_id, user_id)
    return success(data)


@router.delete("/{community_id}/members/{target_user_id}")
async def remove_member(
    community_id: str, target_user_id: str, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
):
    data = await community_service.remove_member(db, community_id, target_user_id, user_id)
    return success(data)


# ── Announcements ─────────────────────────────────────────────────────────────

@router.post("/{community_id}/announcements")
async def create_announcement(
    community_id: str, body: CreateAnnouncementRequest, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
):
    data = await community_service.create_announcement(db, community_id, user_id, body.title, body.body, body.fileUrl)
    return created(data)


@router.get("/{community_id}/announcements")
async def list_announcements(community_id: str, db: DBDep, user_id: CurrentUserIdDep, page: int = 1, limit: int = 20):
    items, total = await community_service.list_announcements(db, community_id, page, limit)
    return success(items, meta={"page": page, "limit": limit, "total": total})


@router.delete("/{community_id}/announcements/{announcement_id}")
async def delete_announcement(
    community_id: str, announcement_id: str, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
):
    data = await community_service.delete_announcement(db, announcement_id, user_id)
    return success(data)


# ── Marks ─────────────────────────────────────────────────────────────────────

@router.post("/{community_id}/marks/upload")
async def upload_marks(
    community_id: str, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
    file: UploadFile = File(...),
):
    if file.content_type not in _ACCEPTED_SPREADSHEET:
        raise ValidationError("Please upload a spreadsheet file (.csv, .xlsx, .xls)", code="INVALID_FILE_TYPE")
    file_data = await file.read()
    data = await community_service.upload_marks(db, community_id, user_id, file_data, file.filename or "upload")
    return success(data)


@router.get("/{community_id}/marks/history")
async def get_marks_history(
    community_id: str,
    db: DBDep,
    user_id: CurrentUserIdDep,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
):
    data = await community_service.get_marks_history(db, community_id)
    return success(data)


@router.get("/{community_id}/marks/scores")
async def get_community_scores(
    community_id: str,
    db: DBDep,
    user_id: CurrentUserIdDep,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
):
    data = await community_service.get_community_scores(db, community_id)
    return success(data)


# ── Attendance ────────────────────────────────────────────────────────────────

@router.post("/{community_id}/attendance")
async def record_attendance(
    community_id: str, body: RecordAttendanceRequest, db: DBDep, user_id: CurrentUserIdDep,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
):
    data = await community_service.record_attendance(
        db, community_id, user_id,
        body.slotId, body.date,
        [{"userId": r.userId, "present": r.present} for r in body.records],
    )
    return success(data)


@router.get("/{community_id}/attendance")
async def get_community_attendance(
    community_id: str, db: DBDep, user_id: CurrentUserIdDep,
    slotId: Optional[str] = None, from_: Optional[str] = None, to: Optional[str] = None,
    _role: str = require_role(Role.TUTOR, Role.ADMIN),
):
    data = await community_service.get_community_attendance(db, community_id, slotId, from_, to)
    return success(data)


@router.get("/{community_id}/attendance/me")
async def get_my_attendance(community_id: str, db: DBDep, user_id: CurrentUserIdDep):
    data = await community_service.get_my_attendance(db, community_id, user_id)
    return success(data)
