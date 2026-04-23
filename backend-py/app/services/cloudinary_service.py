from __future__ import annotations

import asyncio
import logging

import cloudinary
import cloudinary.uploader

from app.core.config import settings

logger = logging.getLogger(__name__)

_configured = False


def _ensure_configured() -> None:
    global _configured
    if not _configured:
        cloudinary.config(
            cloud_name=settings.CLOUDINARY_CLOUD_NAME,
            api_key=settings.CLOUDINARY_API_KEY,
            api_secret=settings.CLOUDINARY_API_SECRET,
        )
        _configured = True


async def upload_file(file_bytes: bytes, folder: str) -> dict:
    """Upload bytes to Cloudinary. Returns {public_id, secure_url}."""
    _ensure_configured()

    def _upload() -> dict:
        result = cloudinary.uploader.upload(
            file_bytes,
            folder=f"{settings.CLOUDINARY_UPLOAD_FOLDER}/{folder}",
            resource_type="auto",
        )
        return {"public_id": result["public_id"], "secure_url": result["secure_url"]}

    return await asyncio.to_thread(_upload)


async def delete_file(public_id: str) -> None:
    _ensure_configured()
    await asyncio.to_thread(cloudinary.uploader.destroy, public_id)
