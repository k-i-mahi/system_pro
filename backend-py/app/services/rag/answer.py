from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ollama_service import chat_completion, chat_completion_stream
from app.services.rag.retriever import RetrievalScope, RetrievedChunk, retrieve_chunks

_SYSTEM_PROMPT = """You are a rigorous academic tutor answering a student's question using ONLY the provided course material excerpts.

Rules:
1. Cite every factual claim inline using [n] where n is the 1-indexed excerpt number. Multiple: [1][3].
2. If the excerpts do not contain the answer, say so plainly — do NOT invent facts. Suggest what the student could upload or ask instead.
3. Prefer the student's textbook language over your own paraphrase when terminology matters.
4. Format with markdown: short paragraphs, bullets for enumerations, KaTeX ($...$) for math.
5. End with a one-line "Next step:" suggestion for follow-up study.

Keep the answer concise and well-structured."""


@dataclass
class AnswerCitation:
    index: int
    material_id: str
    material_title: str
    page: Optional[int]
    heading: Optional[str]
    snippet: str


@dataclass
class AnswerResult:
    answer: str
    citations: list[AnswerCitation]
    chunks: list[RetrievedChunk]
    ingest: Optional[dict[str, Any]] = None


def _format_context(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "(no relevant excerpts retrieved — answer accordingly)"
    parts = []
    for i, c in enumerate(chunks):
        locator = " · ".join(filter(None, [c.material_title, f"p.{c.page}" if c.page else None, f"§ {c.heading}" if c.heading else None]))
        parts.append(f"[{i + 1}] {locator}\n{c.content}")
    return "\n\n".join(parts)


def _should_skip_llm_for_ingest(ingest_meta: dict[str, Any] | None, chunk_count: int) -> bool:
    if chunk_count > 0 or not ingest_meta:
        return False
    total = int(ingest_meta.get("total") or 0)
    ready = int(ingest_meta.get("ready") or 0)
    return total > 0 and ready == 0


def _ingest_wait_message(ingest_meta: dict[str, Any]) -> str:
    lines = [
        "None of the files in this scope are ready for grounded answers yet.",
        "Wait until indexing finishes (or fix failed uploads), then ask again.",
    ]
    p, proc, fail = (
        int(ingest_meta.get("pending") or 0),
        int(ingest_meta.get("processing") or 0),
        int(ingest_meta.get("failed") or 0),
    )
    if p or proc:
        lines.append(f"Status: {p} pending, {proc} processing.")
    if fail:
        lines.append(f"{fail} material(s) failed indexing.")
    errs = ingest_meta.get("errors") or []
    if isinstance(errs, list) and errs:
        lines.append("Details: " + "; ".join(str(e) for e in errs[:5]))
    lines.append("Next step: confirm each selected file shows as indexed in the materials list.")
    return "\n\n".join(lines)


def _to_citation(chunk: RetrievedChunk, index: int) -> AnswerCitation:
    snippet = chunk.content[:240].replace("\n", " ").strip()
    return AnswerCitation(
        index=index,
        material_id=chunk.material_id,
        material_title=chunk.material_title,
        page=chunk.page,
        heading=chunk.heading,
        snippet=snippet,
    )


async def answer_with_citations(
    db: AsyncSession,
    question: str,
    scope: RetrievalScope,
    user_id: str | None = None,
    ingest_meta: dict[str, Any] | None = None,
) -> AnswerResult:
    chunks = await retrieve_chunks(db, question, scope)
    if _should_skip_llm_for_ingest(ingest_meta, len(chunks)):
        msg = _ingest_wait_message(ingest_meta or {})
        return AnswerResult(answer=msg, citations=[], chunks=[], ingest=ingest_meta)

    citations = [_to_citation(c, i + 1) for i, c in enumerate(chunks)]
    context = _format_context(chunks)

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": f"Student question: {question}\n\n--- Course material excerpts ---\n{context}\n--- End excerpts ---"},
    ]

    answer = await chat_completion(messages, route="ask-course", temperature=0.2, user_id=user_id)
    return AnswerResult(answer=answer, citations=citations, chunks=chunks, ingest=ingest_meta)


async def stream_answer_with_citations(
    db: AsyncSession,
    question: str,
    scope: RetrievalScope,
    user_id: str | None = None,
    ingest_meta: dict[str, Any] | None = None,
) -> AsyncGenerator[str, None]:
    if ingest_meta is not None:
        yield f"event: meta\ndata: {json.dumps({'ingest': ingest_meta})}\n\n"

    chunks = await retrieve_chunks(db, question, scope)
    if _should_skip_llm_for_ingest(ingest_meta, len(chunks)):
        msg = _ingest_wait_message(ingest_meta or {})
        yield f"event: token\ndata: {json.dumps({'content': msg})}\n\n"
        yield f"event: citations\ndata: {json.dumps({'citations': [], 'chunkCount': 0})}\n\n"
        yield f"event: done\ndata: {json.dumps({'ok': True})}\n\n"
        return

    citations = [_to_citation(c, i + 1) for i, c in enumerate(chunks)]
    context = _format_context(chunks)

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": f"Student question: {question}\n\n--- Course material excerpts ---\n{context}\n--- End excerpts ---"},
    ]

    async for token in chat_completion_stream(messages, route="ask-course", temperature=0.2, user_id=user_id):
        # Stream a stable object shape so frontend clients can parse chunks consistently.
        yield f"event: token\ndata: {json.dumps({'content': token})}\n\n"

    citation_dicts = [
        {
            "index": c.index,
            "materialId": c.material_id,
            "materialTitle": c.material_title,
            "page": c.page,
            "heading": c.heading,
            "snippet": c.snippet,
        }
        for c in citations
    ]
    yield f"event: citations\ndata: {json.dumps({'citations': citation_dicts, 'chunkCount': len(chunks)})}\n\n"
    yield f"event: done\ndata: {json.dumps({'ok': True})}\n\n"
