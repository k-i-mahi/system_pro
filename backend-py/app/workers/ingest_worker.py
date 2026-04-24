from __future__ import annotations

import logging

from app.services.ingest_service import ingest_material_with_new_session

logger = logging.getLogger(__name__)


async def ingest_material_job(ctx: dict, material_id: str, user_id: str, quality: str = "fast") -> dict:
    return await ingest_material_with_new_session(material_id, user_id, quality)


class WorkerSettings:
    functions = [ingest_material_job]
    queue_name = "ingest"
