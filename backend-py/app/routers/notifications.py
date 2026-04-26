from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.deps import CurrentUserIdDep, DBDep, get_current_user_id
from app.core.response import success
from app.schemas.notifications import ClassResponseRequest
from app.services import notifications_service

router = APIRouter(dependencies=[Depends(get_current_user_id)])


@router.get("")
async def list_notifications(db: DBDep, user_id: CurrentUserIdDep, page: int = 1, limit: int = 20):
    items, total = await notifications_service.list_notifications(db, user_id, page, limit)
    return success(items, meta={"page": page, "limit": limit, "total": total})


@router.get("/unread-count")
async def get_unread_count(db: DBDep, user_id: CurrentUserIdDep):
    data = await notifications_service.get_unread_count(db, user_id)
    return success(data)


@router.patch("/read-all")
async def mark_all_read(db: DBDep, user_id: CurrentUserIdDep):
    data = await notifications_service.mark_all_read(db, user_id)
    return success(data)


@router.patch("/{notif_id}/read")
async def mark_read(notif_id: str, db: DBDep, user_id: CurrentUserIdDep):
    data = await notifications_service.mark_read(db, notif_id, user_id)
    return success(data)


@router.delete("/{notif_id}")
async def delete_notification(notif_id: str, db: DBDep, user_id: CurrentUserIdDep):
    data = await notifications_service.delete_notification(db, notif_id, user_id)
    return success(data)


@router.post("/class-response")
async def submit_class_response(body: ClassResponseRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await notifications_service.submit_class_response(db, user_id, body.model_dump())
    return success(data)
