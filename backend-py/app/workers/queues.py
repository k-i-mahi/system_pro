from __future__ import annotations

import json
import logging
import time
import uuid

import redis.asyncio as aioredis

from app.core.config import settings

logger = logging.getLogger(__name__)

# ARQ queue name for ingest jobs (Python workers — separate from BullMQ)
_INGEST_QUEUE = "arq:queue:ingest"


async def _get_redis() -> aioredis.Redis:
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


async def enqueue_ingest(material_id: str, user_id: str, quality: str = "fast") -> None:
    """Push an ingest job onto the ARQ queue for the Python ingest worker."""
    r = await _get_redis()
    try:
        job_id = str(uuid.uuid4())
        job = {
            "job_id": job_id,
            "function": "ingest_material",
            "args": [],
            "kwargs": {"material_id": material_id, "user_id": user_id, "quality": quality},
            "enqueue_time": time.time(),
        }
        await r.rpush(_INGEST_QUEUE, json.dumps(job))
        logger.info("Enqueued ingest job %s for material %s", job_id, material_id)
    finally:
        await r.aclose()
