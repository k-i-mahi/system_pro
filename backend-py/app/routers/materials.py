from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.deps import CurrentUserIdDep, DBDep, get_current_user_id
from app.core.exceptions import NotFoundError
from app.core.response import success
from app.models.course import Material, Topic

router = APIRouter(dependencies=[Depends(get_current_user_id)])


@router.get("/{material_id}")
async def get_material(material_id: str, db: DBDep, user_id: CurrentUserIdDep):
    material = await db.get(Material, material_id)
    if not material:
        raise NotFoundError("Material not found")

    topic = await db.get(Topic, material.topic_id) if material.topic_id else None

    return success({
        "id": material.id,
        "title": material.title,
        "fileUrl": material.file_url,
        "fileType": material.file_type,
        "ingestStatus": material.ingest_status,
        "hasEmbeddings": material.has_embeddings,
        "chunkCount": material.chunk_count,
        "topic": {"id": topic.id, "title": topic.title, "courseId": topic.course_id} if topic else None,
    })
