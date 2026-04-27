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
    if not settings.CLOUDINARY_CLOUD_NAME or not settings.CLOUDINARY_API_KEY:
        raise RuntimeError(
            "Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, "
            "and CLOUDINARY_API_SECRET in your .env file to enable file uploads."
        )

    _ensure_configured()

    def _upload() -> dict:
        result = cloudinary.uploader.upload(
            file_bytes,
            folder=f"{settings.CLOUDINARY_UPLOAD_FOLDER}/{folder}",
            resource_type="auto",
            access_mode="public",
        )
        return {"public_id": result["public_id"], "secure_url": result["secure_url"]}

    return await asyncio.to_thread(_upload)


async def delete_file(public_id: str) -> None:
    """Legacy best-effort destroy (logs only at call sites). Prefer ``destroy_public_id``."""
    _ensure_configured()
    await asyncio.to_thread(cloudinary.uploader.destroy, public_id)


def cloudinary_is_configured() -> bool:
    return bool(settings.CLOUDINARY_CLOUD_NAME and settings.CLOUDINARY_API_KEY and settings.CLOUDINARY_API_SECRET)


async def destroy_public_id_strict(public_id: str, *, attempts: int = 2) -> None:
    """
    Remove an asset from Cloudinary and **fail** if the API reports an error.

    Accepted results: ``ok`` (deleted) or ``not found`` (already gone).

    **Policy:** Used before DB deletes so we do not orphan hosted files. If Cloudinary
    is not configured in this environment, raises ``ValidationError`` — uploads should
    not have created ``public_id`` in that case; operators must fix config or remove rows manually.

    Retries once on transient failure; then raises ``ServiceUnavailableError`` (503).
    """
    from app.core.exceptions import ServiceUnavailableError, ValidationError

    if not public_id or not str(public_id).strip():
        return
    if not cloudinary_is_configured():
        raise ValidationError(
            "Cloudinary is not configured; refusing to delete material without confirming asset removal. "
            "Set CLOUDINARY_* env vars or remove the row manually.",
            code="CLOUDINARY_NOT_CONFIGURED",
        )
    _ensure_configured()

    last_exc: Exception | None = None
    for attempt in range(max(1, attempts)):
        try:

            def _destroy() -> dict:
                return cloudinary.uploader.destroy(public_id)

            result = await asyncio.to_thread(_destroy)
            res = (result or {}).get("result")
            if res in ("ok", "not found"):
                return
            last_exc = RuntimeError(f"Cloudinary destroy returned: {result!r}")
        except Exception as exc:
            last_exc = exc
            logger.warning("Cloudinary destroy attempt %s failed for %s: %s", attempt + 1, public_id, exc)
            if attempt < attempts - 1:
                await asyncio.sleep(0.35 * (attempt + 1))

    raise ServiceUnavailableError(
        f"Could not delete Cloudinary asset {public_id!r} after {attempts} attempt(s). "
        "No database row was removed. Retry later or delete the asset in Cloudinary manually."
    ) from last_exc
