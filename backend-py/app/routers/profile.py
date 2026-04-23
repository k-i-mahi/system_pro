from fastapi import APIRouter, Depends, File, UploadFile

from app.core.deps import CurrentUserIdDep, DBDep, get_current_user_id
from app.core.exceptions import ValidationError
from app.core.response import success
from app.schemas.profile import UpdateProfileRequest
from app.services import profile_service

_ACCEPTED_IMAGE = {"image/jpeg", "image/png", "image/webp", "image/gif"}

router = APIRouter(dependencies=[Depends(get_current_user_id)])


@router.get("/")
async def get_profile(db: DBDep, user_id: CurrentUserIdDep):
    data = await profile_service.get_profile(db, user_id)
    return success(data)


@router.patch("/")
async def update_profile(body: UpdateProfileRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await profile_service.update_profile(db, user_id, body.model_dump(exclude_none=True))
    return success(data)


@router.post("/avatar")
async def upload_avatar(
    db: DBDep,
    user_id: CurrentUserIdDep,
    avatar: UploadFile = File(...),
):
    if avatar.content_type not in _ACCEPTED_IMAGE:
        raise ValidationError("Only JPEG, PNG, WEBP or GIF images are accepted", code="INVALID_FILE_TYPE")
    if avatar.size and avatar.size > 5 * 1024 * 1024:
        raise ValidationError("File too large (max 5 MB)", code="FILE_TOO_LARGE")
    file_data = await avatar.read()
    data = await profile_service.upload_avatar(db, user_id, file_data)
    return success(data)


@router.delete("/")
async def delete_account(db: DBDep, user_id: CurrentUserIdDep):
    data = await profile_service.delete_account(db, user_id)
    return success(data)
