from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.user import User
from app.services.cloudinary_service import upload_file


def _serialize(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "universityName": user.university_name,
        "avatarUrl": user.avatar_url,
        "bio": user.bio,
        "phone": user.phone,
        "rollNumber": user.roll_number,
        "session": user.session,
        "department": user.department,
        "role": user.role,
        "language": user.language,
        "timezone": user.timezone,
        "createdAt": user.created_at,
    }


async def get_profile(db: AsyncSession, user_id: str) -> dict:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    return _serialize(user)


async def update_profile(db: AsyncSession, user_id: str, data: dict) -> dict:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    field_map = {
        "name": "name",
        "universityName": "university_name",
        "bio": "bio",
        "phone": "phone",
        "rollNumber": "roll_number",
        "session": "session",
        "department": "department",
    }
    for key, attr in field_map.items():
        if key in data and data[key] is not None:
            setattr(user, attr, data[key])
    await db.commit()
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "universityName": user.university_name,
        "avatarUrl": user.avatar_url,
        "bio": user.bio,
        "phone": user.phone,
        "rollNumber": user.roll_number,
        "session": user.session,
        "department": user.department,
        "role": user.role,
    }


async def upload_avatar(db: AsyncSession, user_id: str, file_data: bytes) -> dict:
    result = await upload_file(file_data, "avatars")
    secure_url = result["secure_url"]
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    user.avatar_url = secure_url
    await db.commit()
    return {"id": user.id, "avatarUrl": user.avatar_url}


async def delete_account(db: AsyncSession, user_id: str) -> dict:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not user:
        raise NotFoundError("User not found")
    await db.delete(user)
    await db.commit()
    return {"message": "Account deleted"}
