from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

import httpx
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import AsyncSessionLocal
from app.models.course import Material
from app.models.enums import IngestStatus, MaterialType
from app.services.ocr_service import extract_text_from_file
from app.services.ollama_service import embed

logger = logging.getLogger(__name__)


@dataclass
class Chunk:
    chunk_index: int
    content: str
    page: int | None = None
    heading: str | None = None


def _guess_filename(material: Material) -> str:
    parsed = urlparse(material.file_url or "")
    name = Path(parsed.path).name
    if name:
        return name
    title = material.title or "material"
    return f"{title}.txt"


def _vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(str(v) for v in vec) + "]"


def _approx_tokens(text_value: str) -> int:
    return max(1, len(text_value) // 4)


def _sanitize_text_for_pg(text_value: str) -> str:
    # PostgreSQL text fields reject NUL bytes; some OCR outputs may include them.
    return (text_value or "").replace("\x00", "")


def _chunk_text(text_value: str, target_tokens: int = 800, overlap_tokens: int = 150) -> list[Chunk]:
    cleaned = _sanitize_text_for_pg(text_value).strip()
    if not cleaned:
        return []

    # Lightweight, deterministic paragraph chunking for robust real-data ingest.
    paragraphs = [p.strip() for p in cleaned.split("\n") if p.strip()]
    if not paragraphs:
        paragraphs = [cleaned]

    target_chars = max(1200, target_tokens * 4)
    overlap_chars = max(200, overlap_tokens * 4)
    chunks: list[Chunk] = []
    current = ""

    def push_chunk(content: str) -> None:
        trimmed = content.strip()
        if not trimmed:
            return
        chunks.append(Chunk(chunk_index=len(chunks), content=trimmed))

    for para in paragraphs:
        if len(current) + len(para) + 1 <= target_chars:
            current = f"{current}\n{para}".strip()
            continue
        push_chunk(current)
        carry = current[-overlap_chars:] if current else ""
        current = f"{carry}\n{para}".strip()

    push_chunk(current)
    return chunks


async def _download_material_bytes(file_url: str) -> bytes:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; CognitiveCopilotIngest/1.0)",
        "Accept": "*/*",
    }
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(120.0, connect=30.0),
        follow_redirects=True,
        headers=headers,
    ) as client:
        response = await client.get(file_url)
        response.raise_for_status()
        return response.content


async def ingest_material(db: AsyncSession, material_id: str, user_id: str, quality: str = "fast") -> dict:
    material = await db.get(Material, material_id)
    if not material:
        return {"ok": False, "error": "Material not found"}

    if material.file_type == MaterialType.LINK:
        await db.execute(
            update(Material)
            .where(Material.id == material_id)
            .values(
                has_embeddings=False,
                ingest_status=IngestStatus.DONE,
                ingest_error=None,
                chunk_count=0,
            )
        )
        await db.commit()
        return {"ok": True, "materialId": material_id, "chunkCount": 0}

    await db.execute(
        update(Material)
        .where(Material.id == material_id)
        .values(ingest_status=IngestStatus.PROCESSING, ingest_error=None)
    )
    await db.commit()

    try:
        payload = await _download_material_bytes(material.file_url)
        filename = _guess_filename(material)
        extraction = await extract_text_from_file(payload, filename, "accurate" if quality == "accurate" else "fast")
        extracted_text = (extraction.get("text") or "").strip()

        if not extracted_text:
            raise ValueError("No text extracted from file")

        chunks = _chunk_text(extracted_text)
        if not chunks:
            raise ValueError("Chunking produced no content")

        vectors = await embed([c.content for c in chunks], user_id=user_id)
        if len(vectors) != len(chunks):
            raise ValueError(f"Embedding count mismatch: chunks={len(chunks)} vectors={len(vectors)}")

        await db.execute(text('DELETE FROM "Embedding" WHERE "materialId" = :mid'), {"mid": material_id})
        for chunk, vec in zip(chunks, vectors):
            safe_content = _sanitize_text_for_pg(chunk.content)
            await db.execute(
                text(
                    """
                    INSERT INTO "Embedding"
                        ("id", "materialId", "chunkIndex", "content", "page", "heading", "tokenCount", "embedding", "tsv")
                    VALUES
                        (:id, :material_id, :chunk_index, :content, :page, :heading, :token_count, CAST(:embedding AS vector), to_tsvector('english', coalesce(:content, '')))
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "material_id": material_id,
                    "chunk_index": chunk.chunk_index,
                    "content": safe_content,
                    "page": chunk.page,
                    "heading": chunk.heading,
                    "token_count": _approx_tokens(safe_content),
                    "embedding": _vector_literal(vec),
                },
            )

        await db.execute(
            update(Material)
            .where(Material.id == material_id)
            .values(
                has_embeddings=True,
                ingest_status=IngestStatus.DONE,
                ingest_error=None,
                chunk_count=len(chunks),
            )
        )
        await db.commit()
        return {"ok": True, "materialId": material_id, "chunkCount": len(chunks)}
    except Exception as exc:
        logger.exception("Material ingest failed: %s", exc)
        # SQL errors leave the current transaction aborted under asyncpg.
        # Roll back first so we can persist FAILED status and error details.
        await db.rollback()
        await db.execute(
            update(Material)
            .where(Material.id == material_id)
            .values(
                has_embeddings=False,
                ingest_status=IngestStatus.FAILED,
                ingest_error=str(exc)[:400],
            )
        )
        await db.commit()
        return {"ok": False, "materialId": material_id, "error": str(exc)}


async def ingest_material_with_new_session(material_id: str, user_id: str, quality: str = "fast") -> dict:
    async with AsyncSessionLocal() as db:
        return await ingest_material(db, material_id, user_id, quality)


async def ingest_material_resilient(
    material_id: str,
    user_id: str,
    quality: str = "fast",
    *,
    max_attempts: int = 6,
) -> dict:
    """Run ingest; retry briefly if the material row is not yet visible to a new session."""
    delay_s = 0.08
    last: dict = {"ok": False, "error": "ingest not started"}
    for attempt in range(max_attempts):
        last = await ingest_material_with_new_session(material_id, user_id, quality)
        if last.get("ok"):
            return last
        err = (last.get("error") or "").lower()
        if "not found" in err and attempt < max_attempts - 1:
            logger.warning("Ingest retry %s/%s: material %s not visible yet", attempt + 1, max_attempts, material_id)
            await asyncio.sleep(delay_s * (1 + attempt))
            continue
        return last
    return last
