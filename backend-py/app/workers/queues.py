from __future__ import annotations

import logging

from arq import create_pool
from arq.connections import RedisSettings

from app.core.config import settings

logger = logging.getLogger(__name__)

# ARQ queue name for ingest jobs (Python workers — separate from BullMQ)
_INGEST_QUEUE = "ingest"


def _redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.REDIS_URL)


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
