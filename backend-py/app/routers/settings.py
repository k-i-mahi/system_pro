from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.deps import CurrentUserIdDep, DBDep, get_current_user_id
from app.core.response import success
from app.schemas.settings import UpdateGeneralRequest, UpdateNotificationsRequest, UpdatePasswordRequest
from app.services import settings_service

router = APIRouter(dependencies=[Depends(get_current_user_id)])


@router.get("")
async def get_settings(db: DBDep, user_id: CurrentUserIdDep):
    data = await settings_service.get_settings(db, user_id)
    return success(data)


@router.patch("/general")
async def update_general(body: UpdateGeneralRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await settings_service.update_general(db, user_id, body.model_dump(exclude_none=True))
    return success(data)


@router.patch("/password")
async def update_password(body: UpdatePasswordRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await settings_service.update_password(db, user_id, body.oldPassword, body.newPassword)
    return success(data)


@router.patch("/notifications")
async def update_notifications(body: UpdateNotificationsRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await settings_service.update_notifications(db, user_id, body.model_dump(exclude_none=True))
    return success(data)
