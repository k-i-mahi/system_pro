from __future__ import annotations

from dataclasses import dataclass
from typing import AsyncGenerator, Callable, Optional

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


def _format_context(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "(no relevant excerpts retrieved — answer accordingly)"
    parts = []
    for i, c in enumerate(chunks):
        locator = " · ".join(filter(None, [c.material_title, f"p.{c.page}" if c.page else None, f"§ {c.heading}" if c.heading else None]))
        parts.append(f"[{i + 1}] {locator}\n{c.content}")
    return "\n\n".join(parts)


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
) -> AnswerResult:
    chunks = await retrieve_chunks(db, question, scope)
    citations = [_to_citation(c, i + 1) for i, c in enumerate(chunks)]
    context = _format_context(chunks)

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": f"Student question: {question}\n\n--- Course material excerpts ---\n{context}\n--- End excerpts ---"},
    ]

    answer = await chat_completion(messages, route="ask-course", temperature=0.2, user_id=user_id)
    return AnswerResult(answer=answer, citations=citations, chunks=chunks)


async def stream_answer_with_citations(
    db: AsyncSession,
    question: str,
    scope: RetrievalScope,
    user_id: str | None = None,
) -> AsyncGenerator[str, None]:
    chunks = await retrieve_chunks(db, question, scope)
    citations = [_to_citation(c, i + 1) for i, c in enumerate(chunks)]
    context = _format_context(chunks)

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": f"Student question: {question}\n\n--- Course material excerpts ---\n{context}\n--- End excerpts ---"},
    ]

    import json
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
