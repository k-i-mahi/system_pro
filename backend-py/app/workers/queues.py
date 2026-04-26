from __future__ import annotations

import logging

from arq import create_pool
from arq.connections import RedisSettings

from app.core.config import settings

logger = logging.getLogger(__name__)

# ARQ queue names
_INGEST_QUEUE = "ingest"
_NOTIF_QUEUE = "notifications"


def _redis_settings() -> RedisSettings:
    # Prefer ARQ_REDIS_URL for dedicated ARQ connection, fall back to REDIS_URL.
    url = getattr(settings, "ARQ_REDIS_URL", None) or settings.REDIS_URL
    return RedisSettings.from_dsn(url)


async def enqueue_ingest(material_id: str, user_id: str, quality: str = "fast") -> None:
    """Push an ingest job onto ARQ queue for ingest worker."""
    redis = await create_pool(_redis_settings())
    try:
        await redis.enqueue_job(
            "ingest_material_job",
            material_id,
            user_id,
            quality,
            _queue_name=_INGEST_QUEUE,
        )
        logger.info("Enqueued ingest job for material %s", material_id)
    finally:
        await redis.aclose()


async def enqueue_notification_scan() -> None:
    """Manually trigger a notification scan job."""
    redis = await create_pool(_redis_settings())
    try:
        await redis.enqueue_job("scan_schedule_reminders", _queue_name=_NOTIF_QUEUE)
        logger.info("Enqueued notification scan job")
    finally:
        await redis.aclose()
