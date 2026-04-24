from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.services.ollama_service import embed

logger = logging.getLogger(__name__)

CANDIDATE_LIMIT = 40
RRF_K = 60


@dataclass
class RetrievedChunk:
    id: str
    material_id: str
    material_title: str
    chunk_index: int
    content: str
    page: Optional[int]
    heading: Optional[str]
    cosine_distance: Optional[float]
    bm25_rank: Optional[int]
    vector_rank: Optional[int]
    fused_score: float


@dataclass
class RetrievalScope:
    course_id: Optional[str] = None
    topic_id: Optional[str] = None
    material_ids: Optional[list[str]] = None
    user_id: Optional[str] = None


def _normalize_query(query: str) -> str:
    normalized = re.sub(r"\s+", " ", query).strip().lower()
    normalized = re.sub(r"[^\w\s]", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized


def _query_terms(query: str) -> list[str]:
    stop = {
        "the", "a", "an", "is", "are", "was", "were", "to", "for", "of", "in", "on",
        "and", "or", "with", "by", "from", "at", "as", "this", "that", "it", "be",
        "can", "i", "we", "you", "do", "does", "did", "how", "what", "why", "when",
    }
    terms = [t for t in _normalize_query(query).split(" ") if len(t) > 1 and t not in stop]
    return terms[:24]


def _lexical_overlap_score(terms: list[str], text_value: str) -> float:
    if not terms:
        return 0.0
    hay = _normalize_query(text_value)
    if not hay:
        return 0.0
    hits = sum(1 for term in terms if term in hay)
    return hits / len(terms)


def _content_fingerprint(text_value: str) -> str:
    normalized = _normalize_query(text_value)
    return normalized[:300]


def _vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(str(v) for v in vec) + "]"


async def _resolve_material_scope(db: AsyncSession, scope: RetrievalScope) -> list[str] | None:
    if scope.material_ids:
        return scope.material_ids

    conditions = ["m.\"hasEmbeddings\" = true"]
    params: dict = {}

    if scope.course_id:
        conditions.append('t."courseId" = :course_id')
        params["course_id"] = scope.course_id
    elif scope.topic_id:
        conditions.append('m."topicId" = :topic_id')
        params["topic_id"] = scope.topic_id

    if len(conditions) == 1:
        return None  # no scope → global

    where = " AND ".join(conditions)
    join = 'JOIN "Topic" t ON t."id" = m."topicId"' if scope.course_id else ""
    sql = f'SELECT m."id" FROM "Material" m {join} WHERE {where}'

    rows = (await db.execute(text(sql), params)).fetchall()
    return [r[0] for r in rows]


async def _vector_search(db: AsyncSession, vec_literal: str, material_ids: list[str] | None, limit: int) -> list[dict]:
    clauses = []
    params: dict = {"vec": vec_literal}

    if material_ids is not None:
        clauses.append('e."materialId" = ANY(:mat_ids)')
        params["mat_ids"] = material_ids

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    sql = f"""
        SELECT
          e."id", e."materialId", m."title" AS "materialTitle",
          e."chunkIndex", e."content", e."page", e."heading",
          (e."embedding" <=> :vec::vector) AS distance
        FROM "Embedding" e
        JOIN "Material" m ON m."id" = e."materialId"
        {where}
        ORDER BY e."embedding" <=> :vec::vector
        LIMIT :lim
    """
    params["lim"] = limit
    rows = (await db.execute(text(sql), params)).fetchall()
    return [dict(r._mapping) for r in rows]


async def _bm25_search(db: AsyncSession, query: str, material_ids: list[str] | None, limit: int) -> list[dict]:
    clauses = ["e.\"tsv\" @@ websearch_to_tsquery('english', :q)"]
    params: dict = {"q": query}

    if material_ids is not None:
        clauses.append('e."materialId" = ANY(:mat_ids)')
        params["mat_ids"] = material_ids

    where = " AND ".join(clauses)
    sql = f"""
        SELECT
          e."id", e."materialId", m."title" AS "materialTitle",
          e."chunkIndex", e."content", e."page", e."heading",
          ts_rank_cd(e."tsv", websearch_to_tsquery('english', :q)) AS rank
        FROM "Embedding" e
        JOIN "Material" m ON m."id" = e."materialId"
        WHERE {where}
        ORDER BY rank DESC
        LIMIT :lim
    """
    params["lim"] = limit
    try:
        rows = (await db.execute(text(sql), params)).fetchall()
        return [dict(r._mapping) for r in rows]
    except Exception:
        # Fallback parser for queries with symbols/operators websearch can't parse.
        fallback_sql = f"""
            SELECT
              e."id", e."materialId", m."title" AS "materialTitle",
              e."chunkIndex", e."content", e."page", e."heading",
              ts_rank_cd(e."tsv", plainto_tsquery('english', :q)) AS rank
            FROM "Embedding" e
            JOIN "Material" m ON m."id" = e."materialId"
            WHERE {' AND '.join(c.replace("websearch_to_tsquery('english', :q)", "plainto_tsquery('english', :q)") for c in clauses)}
            ORDER BY rank DESC
            LIMIT :lim
        """
        rows = (await db.execute(text(fallback_sql), params)).fetchall()
        return [dict(r._mapping) for r in rows]


def _rrf(vector_hits: list[dict], bm25_hits: list[dict]) -> list[RetrievedChunk]:
    acc: dict[str, RetrievedChunk] = {}

    for idx, row in enumerate(vector_hits):
        rank = idx + 1
        acc[row["id"]] = RetrievedChunk(
            id=row["id"],
            material_id=row["materialId"],
            material_title=row["materialTitle"],
            chunk_index=row["chunkIndex"],
            content=row["content"],
            page=row["page"],
            heading=row["heading"],
            cosine_distance=float(row["distance"]) if row["distance"] is not None else None,
            bm25_rank=None,
            vector_rank=rank,
            fused_score=1.0 / (RRF_K + rank),
        )

    for idx, row in enumerate(bm25_hits):
        rank = idx + 1
        existing = acc.get(row["id"])
        if existing:
            existing.bm25_rank = rank
            existing.fused_score += 1.0 / (RRF_K + rank)
        else:
            acc[row["id"]] = RetrievedChunk(
                id=row["id"],
                material_id=row["materialId"],
                material_title=row["materialTitle"],
                chunk_index=row["chunkIndex"],
                content=row["content"],
                page=row["page"],
                heading=row["heading"],
                cosine_distance=None,
                bm25_rank=rank,
                vector_rank=None,
                fused_score=1.0 / (RRF_K + rank),
            )

    return sorted(acc.values(), key=lambda c: c.fused_score, reverse=True)


def _rerank_and_select(fused: list[RetrievedChunk], query: str, top_k: int) -> list[RetrievedChunk]:
    if not fused:
        return []

    terms = _query_terms(query)
    if not terms:
        return fused[:top_k]

    max_fused = max((c.fused_score for c in fused), default=1.0) or 1.0
    rescored: list[tuple[float, RetrievedChunk]] = []
    for c in fused:
        lexical = _lexical_overlap_score(terms, c.content)
        title_bonus = 0.12 * _lexical_overlap_score(terms, c.material_title)
        heading_bonus = 0.10 * _lexical_overlap_score(terms, c.heading or "")
        semantic = c.fused_score / max_fused
        combined = (0.62 * semantic) + (0.28 * lexical) + title_bonus + heading_bonus
        rescored.append((combined, c))

    rescored.sort(key=lambda item: item[0], reverse=True)

    # Deduplicate near-identical snippets and keep material diversity.
    selected: list[RetrievedChunk] = []
    seen_fingerprints: set[str] = set()
    per_material: dict[str, int] = {}
    max_per_material = 2

    min_chars = 22
    for _, chunk in rescored:
        if len((chunk.content or "").strip()) < min_chars:
            continue
        fp = _content_fingerprint(chunk.content)
        if fp in seen_fingerprints:
            continue
        count = per_material.get(chunk.material_id, 0)
        if count >= max_per_material:
            continue
        selected.append(chunk)
        seen_fingerprints.add(fp)
        per_material[chunk.material_id] = count + 1
        if len(selected) >= top_k:
            break

    # Fill remaining slots if diversity cap was too strict.
    if len(selected) < top_k:
        for _, chunk in rescored:
            fp = _content_fingerprint(chunk.content)
            if fp in seen_fingerprints:
                continue
            selected.append(chunk)
            seen_fingerprints.add(fp)
            if len(selected) >= top_k:
                break

    return selected[:top_k]


async def retrieve_chunks(
    db: AsyncSession,
    query: str,
    scope: RetrievalScope,
    top_k: int | None = None,
) -> list[RetrievedChunk]:
    if top_k is None:
        top_k = settings.RAG_TOP_K

    trimmed = query.strip()
    if not trimmed:
        return []

    material_ids = await _resolve_material_scope(db, scope)
    if material_ids is not None and len(material_ids) == 0:
        return []

    try:
        vecs = await embed(trimmed, user_id=scope.user_id)
        query_vec = vecs[0] if vecs else []
    except Exception as exc:
        logger.warning("Embedding failed: %s", exc)
        query_vec = []

    if query_vec:
        vec_literal = _vector_literal(query_vec)
        vector_hits, bm25_hits = await _vector_search(db, vec_literal, material_ids, CANDIDATE_LIMIT), []
        try:
            normalized = _normalize_query(trimmed)
            bm25_hits = await _bm25_search(db, trimmed, material_ids, CANDIDATE_LIMIT)
            if normalized and normalized != trimmed.lower():
                extra_hits = await _bm25_search(db, normalized, material_ids, CANDIDATE_LIMIT // 2)
                seen = {h["id"] for h in bm25_hits}
                bm25_hits.extend([h for h in extra_hits if h["id"] not in seen])
        except Exception as exc:
            logger.warning("BM25 search failed: %s", exc)
        fused = _rrf(vector_hits, bm25_hits)
    else:
        try:
            bm25_hits = await _bm25_search(db, trimmed, material_ids, CANDIDATE_LIMIT)
            fused = [
                RetrievedChunk(
                    id=r["id"], material_id=r["materialId"], material_title=r["materialTitle"],
                    chunk_index=r["chunkIndex"], content=r["content"], page=r["page"], heading=r["heading"],
                    cosine_distance=None, bm25_rank=i + 1, vector_rank=None, fused_score=1.0 / (RRF_K + i + 1),
                )
                for i, r in enumerate(bm25_hits)
            ]
        except Exception as exc:
            logger.warning("BM25 fallback failed: %s", exc)
            fused = []

    return _rerank_and_select(fused, trimmed, top_k)
