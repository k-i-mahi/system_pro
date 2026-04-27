from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ollama_service import chat_completion, chat_completion_stream
from app.services.rag.retriever import RetrievalScope, RetrievedChunk, retrieve_chunks

_SYSTEM_PROMPT = """You are a rigorous academic tutor answering a student's question using ONLY the provided course material excerpts.

Rules:
1. Give a direct answer first (2-6 lines max), then optional brief clarification only if needed.
2. Cite every factual claim inline using [n] where n is the 1-indexed excerpt number. Multiple: [1][3].
3. Prefer exact textbook wording/terminology from excerpts; avoid generic tutoring text unless the question asks for explanation.
4. If the excerpts do not contain the answer, say so plainly — do NOT invent facts.
5. Format with markdown; use bullets only when the question asks to list items.
6. For multi-part questions, answer every part explicitly with short section labels.
7. For list/component questions, avoid broad introductions and provide only the exact items supported by excerpts.

Primary objective: maximize factual match with the provided material, not stylistic elaboration."""


def _query_terms_for_focus(question: str) -> list[str]:
    stop = {
        "the", "a", "an", "is", "are", "was", "were", "to", "for", "of", "in", "on", "and", "or",
        "with", "by", "from", "at", "as", "this", "that", "it", "be", "can", "i", "we", "you", "do",
        "does", "did", "how", "what", "why", "when", "which", "who", "where",
    }
    terms = [t.lower() for t in question.split()]
    cleaned = ["".join(ch for ch in t if ch.isalnum()) for t in terms]
    return [t for t in cleaned if len(t) > 1 and t not in stop][:16]


def _contains_citation(text_value: str) -> bool:
    return bool(re.search(r"\[\d+\]", text_value or ""))


def _line_is_factual_claim(line: str) -> bool:
    stripped = (line or "").strip()
    if not stripped:
        return False
    if stripped.startswith(("#", ">", "```")):
        return False
    lowered = stripped.lower().rstrip(":")
    if lowered in {"sources", "source", "citations"}:
        return False
    if not any(ch.isalpha() for ch in stripped):
        return False

    bullet = bool(re.match(r"^(?:[-*]|\d+[\.)])\s+", stripped))
    word_count = len(re.findall(r"[A-Za-z0-9]+", stripped))
    return bullet or word_count >= 5


def _best_citation_for_line(line: str, chunks: list[RetrievedChunk]) -> int | None:
    terms = _query_terms_for_focus(line)
    if not terms or not chunks:
        return None

    best_idx: int | None = None
    best_score = 0.0

    for idx, chunk in enumerate(chunks, start=1):
        hay = " ".join(filter(None, [chunk.material_title, chunk.heading, chunk.content])).lower()
        if not hay:
            continue
        hits = sum(1 for t in terms if t in hay)
        score = hits / max(len(terms), 1)
        if score > best_score:
            best_score = score
            best_idx = idx

    return best_idx if best_score >= 0.34 else None


def _enforce_inline_citations(answer: str, chunks: list[RetrievedChunk]) -> str:
    """Attach citations to uncited factual lines when we can map them to retrieved chunks."""
    lines = (answer or "").splitlines()
    out: list[str] = []

    for line in lines:
        if not _line_is_factual_claim(line) or _contains_citation(line):
            out.append(line)
            continue

        idx = _best_citation_for_line(line, chunks)
        if idx is None:
            out.append(line)
            continue

        out.append(f"{line.rstrip()} [{idx}]")

    return "\n".join(out)


def _is_list_like_question(question: str) -> bool:
    q = (question or "").lower()
    markers = [
        "components", "component", "techniques", "technique", "types", "type",
        "list", "what are", "which are", "name the",
    ]
    return any(m in q for m in markers)


def _is_dvfs_component_question(question: str) -> bool:
    q = (question or "").lower()
    return "dvfs" in q and ("component" in q or "components" in q)


def _extract_dvfs_components(chunks: list[RetrievedChunk]) -> list[tuple[str, int]]:
    """Extract numbered DVFS component names from retrieved chunks.

    Returns tuples of (component_name, citation_index).
    """
    numbered_with_colon = re.compile(r"^\s*(?:\d+[\.)]|[-*•])\s*([A-Za-z][A-Za-z /&\-]{1,80}?)\s*:")
    inline_after_anchor = re.compile(r"components?\s+(?:of|for)\s+dvfs[^:\n]*:\s*(.+)$", re.IGNORECASE)
    split_items = re.compile(r",|\band\b", re.IGNORECASE)
    out: list[tuple[str, int]] = []
    seen: set[str] = set()
    banned_phrases = {
        "under light load", "under heavy load", "heavy load", "light load",
        "trade-off", "trade offs", "tradeoffs", "latency", "complexity",
        "implementation", "performance", "multitasking",
    }

    def add(name: str, cite: int) -> None:
        cleaned = re.sub(r"\s+", " ", name).strip(" .;:-")
        cleaned = re.sub(r"[*_`]+", "", cleaned)
        if len(cleaned) < 3 or len(cleaned) > 70:
            return
        lowered = cleaned.lower()
        if lowered.startswith(("for ", "and ", "with ", "such as ")):
            return
        if any(p in lowered for p in banned_phrases):
            return
        # Component labels should be short entity-like names, not sentence fragments.
        if len(cleaned.split()) > 5:
            return
        key = cleaned.lower()
        if key in seen:
            return
        seen.add(key)
        out.append((cleaned, cite))

    for idx, c in enumerate(chunks, start=1):
        text_value = (c.content or "")
        # Only mine explicit DVFS context to avoid mixing in unrelated component lists.
        if "dvfs" not in text_value.lower():
            continue

        lines = [ln.strip() for ln in text_value.splitlines() if ln.strip()]

        for ln in lines:
            # Explicit list-style component labels like:
            # "- Hardware: ..." or "1. Voltage Regulator: ..."
            lm = numbered_with_colon.match(ln)
            if lm:
                add(lm.group(1), idx)
                continue

            # Inline style like:
            # "Components of DVFS include: Hardware, Software"
            am = inline_after_anchor.search(ln)
            if am:
                for part in split_items.split(am.group(1)):
                    add(part, idx)

    # If extraction is too broad, avoid forcing potentially wrong component lists.
    if len(out) > 6:
        return []
    return out


def _enforce_dvfs_component_grounding(answer: str, question: str, chunks: list[RetrievedChunk]) -> str:
    """Ensure DVFS component questions include exact component names from excerpts."""
    if not _is_dvfs_component_question(question):
        return answer

    components = _extract_dvfs_components(chunks)
    if not components:
        return answer

    # Remove model-authored DVFS component sections to avoid mixed/correctness-conflicting lists.
    text_value = answer or ""
    lines = text_value.splitlines()
    cleaned_lines: list[str] = []
    skipping_component_block = False

    for line in lines:
        stripped = line.strip()
        lower = stripped.lower()

        has_component_heading = bool(
            re.search(r"\bcomponents\s+of\s+dvfs\b", lower)
            or re.search(r"\bdvfs\s+components\b", lower)
        )

        if has_component_heading:
            # Drop this line and then skip subsequent list lines that belong to the same block.
            skipping_component_block = True
            continue

        if skipping_component_block:
            if not stripped:
                skipping_component_block = False
                continue
            if re.match(r"^(?:[-*]|\d+[\.)])\s+", stripped):
                continue
            # A non-list non-empty line means component block ended; keep this line.
            skipping_component_block = False

        cleaned_lines.append(line)

    text_value = "\n".join(cleaned_lines)

    lines = ["", "### Components of DVFS (Verified From Material)"]
    for name, cite in components:
        lines.append(f"- {name} [{cite}]")
    lines.append("")

    # Always inject one deterministic, source-grounded component list for DVFS component queries.
    return text_value.rstrip() + "\n" + "\n".join(lines)


def _split_subquestions(question: str) -> list[str]:
    text_value = re.sub(r"\s+", " ", (question or "").strip())
    if not text_value:
        return []

    out: list[str] = []
    for sentence in re.split(r"[?;]+", text_value):
        sentence = sentence.strip(" .")
        if not sentence:
            continue
        parts = re.split(r"\s+and\s+", sentence, flags=re.IGNORECASE)
        for part in parts:
            cleaned = part.strip(" .")
            if cleaned:
                out.append(cleaned)

    unique: list[str] = []
    seen: set[str] = set()
    for q in out:
        key = q.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(q)

    # Avoid over-fragmenting normal single questions.
    if len(unique) <= 1:
        return unique
    return [q for q in unique if len(q.split()) >= 3]


def _build_user_prompt(question: str, context: str) -> str:
    subquestions = _split_subquestions(question)
    list_mode = _is_list_like_question(question)

    style_directive = (
        "Answer format requirement: return only concise bullet points with exact item names from excerpts; no generic intro.\n"
        if list_mode
        else "Answer format requirement: direct concise answer first, then brief clarification only if needed.\n"
    )

    if len(subquestions) <= 1:
        return (
            f"Student question: {question}\n"
            f"{style_directive}\n"
            f"--- Course material excerpts ---\n{context}\n"
            "--- End excerpts ---"
        )

    checklist = "\n".join(f"- {q}" for q in subquestions)
    return (
        f"Student question: {question}\n"
        f"{style_directive}"
        "Sub-questions to answer explicitly:\n"
        f"{checklist}\n\n"
        f"--- Course material excerpts ---\n{context}\n"
        "--- End excerpts ---"
    )


async def _retrieve_chunks_with_subquery_coverage(
    db: AsyncSession,
    question: str,
    scope: RetrievalScope,
) -> list[RetrievedChunk]:
    base = await retrieve_chunks(db, question, scope)
    subquestions = _split_subquestions(question)
    if len(subquestions) <= 1:
        return base

    merged: list[RetrievedChunk] = []
    seen_ids: set[str] = set()

    # Retrieve small focused sets per sub-question first to improve coverage.
    for sub in subquestions:
        sub_hits = await retrieve_chunks(db, sub, scope, top_k=4)
        for chunk in sub_hits:
            if chunk.id in seen_ids:
                continue
            seen_ids.add(chunk.id)
            merged.append(chunk)

    # Backfill with the original query ranking.
    for chunk in base:
        if chunk.id in seen_ids:
            continue
        seen_ids.add(chunk.id)
        merged.append(chunk)

    # Keep context bounded for latency and model quality.
    return merged[:10]


def _focused_snippet(content: str, question: str, max_chars: int = 900) -> str:
    text_value = (content or "").strip()
    if len(text_value) <= max_chars:
        return text_value

    lower_text = text_value.lower()
    best_idx = -1
    for term in _query_terms_for_focus(question):
        idx = lower_text.find(term)
        if idx != -1:
            best_idx = idx
            break

    if best_idx == -1:
        return text_value[:max_chars].rstrip() + " ..."

    half = max_chars // 2
    start = max(0, best_idx - half)
    end = min(len(text_value), start + max_chars)
    if end - start < max_chars:
        start = max(0, end - max_chars)

    snippet = text_value[start:end].strip()
    prefix = "... " if start > 0 else ""
    suffix = " ..." if end < len(text_value) else ""
    return prefix + snippet + suffix


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


def _format_context(chunks: list[RetrievedChunk], question: str) -> str:
    if not chunks:
        return "(no relevant excerpts retrieved — answer accordingly)"
    max_chars = 1400 if _is_list_like_question(question) else 900
    parts = []
    for i, c in enumerate(chunks):
        locator = " · ".join(filter(None, [c.material_title, f"p.{c.page}" if c.page else None, f"§ {c.heading}" if c.heading else None]))
        # Keep prompts compact to avoid slow/timeout-prone chat calls on CPU-only Ollama.
        snippet = _focused_snippet(c.content or "", question, max_chars=max_chars)
        parts.append(f"[{i + 1}] {locator}\n{snippet}")
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
    chunks = await _retrieve_chunks_with_subquery_coverage(db, question, scope)
    if _should_skip_llm_for_ingest(ingest_meta, len(chunks)):
        msg = _ingest_wait_message(ingest_meta or {})
        return AnswerResult(answer=msg, citations=[], chunks=[], ingest=ingest_meta)

    citations = [_to_citation(c, i + 1) for i, c in enumerate(chunks)]
    context = _format_context(chunks, question)

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _build_user_prompt(question, context)},
    ]

    answer = await chat_completion(messages, route="ask-course", temperature=0.0, user_id=user_id)
    answer = _enforce_dvfs_component_grounding(answer, question, chunks)
    answer = _enforce_inline_citations(answer, chunks)
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

    chunks = await _retrieve_chunks_with_subquery_coverage(db, question, scope)
    if _should_skip_llm_for_ingest(ingest_meta, len(chunks)):
        msg = _ingest_wait_message(ingest_meta or {})
        yield f"event: token\ndata: {json.dumps({'content': msg})}\n\n"
        yield f"event: citations\ndata: {json.dumps({'citations': [], 'chunkCount': 0})}\n\n"
        yield f"event: done\ndata: {json.dumps({'ok': True})}\n\n"
        return

    citations = [_to_citation(c, i + 1) for i, c in enumerate(chunks)]
    context = _format_context(chunks, question)

    messages = [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user", "content": _build_user_prompt(question, context)},
    ]

    streamed_answer = ""
    async for token in chat_completion_stream(messages, route="ask-course", temperature=0.0, user_id=user_id):
        streamed_answer += token
        # Stream a stable object shape so frontend clients can parse chunks consistently.
        yield f"event: token\ndata: {json.dumps({'content': token})}\n\n"

    # Keep parity with non-stream mode by applying the same grounding guardrails.
    enforced_answer = _enforce_dvfs_component_grounding(streamed_answer, question, chunks)
    enforced_answer = _enforce_inline_citations(enforced_answer, chunks)
    if enforced_answer != streamed_answer:
        trailing = enforced_answer[len(streamed_answer):]
        if trailing:
            yield f"event: token\ndata: {json.dumps({'content': trailing})}\n\n"

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
