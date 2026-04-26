from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any, AsyncGenerator, Callable, Optional

import httpx

from app.core.config import settings
from app.models.enums import LlmCallStatus

logger = logging.getLogger(__name__)

OllamaMessage = dict  # {"role": str, "content": str}


def approx_tokens(text: str) -> int:
    return max(1, len(text) // 4)


def build_system_prompt(course_name: str | None = None, topic_title: str | None = None) -> str:
    context = ""
    if course_name:
        context += f'Course: "{course_name}". '
    if topic_title:
        context += f'Topic: "{topic_title}". '
    return (
        "You are an intelligent academic tutor for university students on the Cognitive Copilot platform.\n"
        + (f"Context: {context}\n" if context else "")
        + "You help students understand topics deeply, generate quizzes, explain concepts clearly,\n"
        "suggest study materials, and adapt to the student's level.\n"
        "Be concise, structured, and pedagogically sound.\n"
        'When generating quizzes, output strict JSON: { "questions": [{"id": "q1", "question": "...", "options": ["A","B","C","D"], "correct": "A"}] }\n'
        "When not generating quizzes, use markdown formatting for clarity."
    )


async def _log_llm_call(
    route: str,
    model: str,
    prompt_payload: dict,
    completion: str,
    prompt_tokens: int,
    completion_tokens: int,
    latency_ms: int,
    status: LlmCallStatus,
    error_msg: str | None,
    user_id: str | None,
) -> None:
    from app.db.session import AsyncSessionLocal
    from app.models.misc import LlmCall
    try:
        async with AsyncSessionLocal() as session:
            call = LlmCall(
                user_id=user_id,
                route=route,
                model=model,
                prompt=prompt_payload,
                completion=completion,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                latency_ms=latency_ms,
                status=status,
                error_msg=error_msg,
            )
            session.add(call)
            await session.commit()
    except Exception as exc:
        logger.warning("LLM call logging failed: %s", exc)


async def chat_completion(
    messages: list[OllamaMessage],
    route: str = "chat",
    temperature: float | None = None,
    top_p: float | None = None,
    num_ctx: int | None = None,
    format: Any = None,
    user_id: str | None = None,
    on_chunk: Callable[[str], None] | None = None,
    signal: asyncio.Event | None = None,
) -> str:
    body: dict = {"model": settings.OLLAMA_MODEL, "messages": messages, "stream": on_chunk is not None}
    ollama_opts: dict = {}
    if temperature is not None:
        ollama_opts["temperature"] = temperature
    if top_p is not None:
        ollama_opts["top_p"] = top_p
    if num_ctx is not None:
        ollama_opts["num_ctx"] = num_ctx
    if ollama_opts:
        body["options"] = ollama_opts
    if format is not None:
        body["format"] = format

    t0 = time.monotonic()
    full = ""
    prompt_tokens = 0
    completion_tokens = 0
    status = LlmCallStatus.OK
    error_msg: str | None = None

    try:
        if on_chunk:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
                async with client.stream("POST", f"{settings.OLLAMA_BASE_URL}/api/chat", json=body) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line:
                            continue
                        try:
                            chunk = json.loads(line)
                            content = (chunk.get("message") or {}).get("content", "")
                            if content:
                                full += content
                                on_chunk(content)
                            if chunk.get("done"):
                                prompt_tokens = chunk.get("prompt_eval_count", 0) or 0
                                completion_tokens = chunk.get("eval_count", 0) or 0
                        except json.JSONDecodeError:
                            pass
        else:
            async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
                r = await client.post(f"{settings.OLLAMA_BASE_URL}/api/chat", json=body)
                r.raise_for_status()
                data = r.json()
                full = (data.get("message") or {}).get("content", "")
                prompt_tokens = data.get("prompt_eval_count", 0) or 0
                completion_tokens = data.get("eval_count", 0) or 0

    except Exception as exc:
        status = LlmCallStatus.ERROR
        error_msg = str(exc)
        _rethrow_with_friendly_msg(exc)

    finally:
        latency_ms = round((time.monotonic() - t0) * 1000)
        if not prompt_tokens:
            prompt_tokens = approx_tokens("\n".join(m.get("content", "") for m in messages))
        if not completion_tokens:
            completion_tokens = approx_tokens(full)
        asyncio.create_task(_log_llm_call(
            route=route,
            model=settings.OLLAMA_MODEL,
            prompt_payload={"model": settings.OLLAMA_MODEL, "messages": messages},
            completion=full,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            status=status,
            error_msg=error_msg,
            user_id=user_id,
        ))

    return full


async def chat_completion_structured(
    messages: list[OllamaMessage],
    schema: dict,
    route: str = "chat.structured",
    temperature: float | None = None,
    user_id: str | None = None,
) -> Any:
    raw = await chat_completion(messages, route=route, temperature=temperature, format=schema, user_id=user_id)
    trimmed = raw.strip()
    try:
        return json.loads(trimmed)
    except json.JSONDecodeError:
        first = trimmed.find("{")
        last = trimmed.rfind("}")
        if first != -1 and last > first:
            return json.loads(trimmed[first:last + 1])
        raise ValueError(f"Structured output is not valid JSON: {trimmed[:200]}")


def fit_embedding_to_db_dim(vec: list[float], target_dim: int | None = None) -> list[float]:
    """Pad/truncate to match pgvector column (Ollama model output may differ from DB width)."""
    if target_dim is None:
        target_dim = settings.OLLAMA_EMBEDDING_DIM
    if target_dim <= 0 or not vec:
        return vec
    n = len(vec)
    if n == target_dim:
        return vec
    if n > target_dim:
        if n - target_dim > 8:
            logger.warning("Truncating query/document embedding from %d to %d dimensions", n, target_dim)
        return vec[:target_dim]
    return vec + [0.0] * (target_dim - n)


def _parse_ollama_embed_response(data: dict) -> list[list[float]]:
    """Normalize /api/embed JSON across Ollama versions."""
    raw = data.get("embeddings")
    if raw is not None and isinstance(raw, list) and len(raw) > 0:
        return raw
    one = data.get("embedding")
    if one is not None and isinstance(one, list) and len(one) > 0:
        if isinstance(one[0], (int, float)):
            return [list(one)]
        if isinstance(one[0], list):
            return list(one)
    raise ValueError(f"Ollama /api/embed returned no vectors (keys={list(data.keys())})")


_EMBED_BATCH_SIZE = 24


async def _embed_batch(texts: list[str], user_id: str | None) -> list[list[float]]:
    """Single /api/embed call; kept small so Ollama does not time out on long documents."""
    if not texts:
        return []
    t0 = time.monotonic()
    status = LlmCallStatus.OK
    error_msg: str | None = None
    embeddings: list[list[float]] = []

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=30.0)) as client:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/embed",
                json={"model": settings.OLLAMA_EMBEDDING_MODEL, "input": texts},
            )
            r.raise_for_status()
            embeddings = _parse_ollama_embed_response(r.json())
        if len(embeddings) != len(texts):
            raise ValueError(
                f"Ollama embed count mismatch: got {len(embeddings)} vectors for {len(texts)} inputs"
            )
        dim = settings.OLLAMA_EMBEDDING_DIM
        embeddings = [fit_embedding_to_db_dim(v, dim) for v in embeddings]
    except Exception as exc:
        status = LlmCallStatus.ERROR
        error_msg = str(exc)
        raise
    finally:
        latency_ms = round((time.monotonic() - t0) * 1000)
        prompt_tokens = approx_tokens("\n".join(texts))
        asyncio.create_task(_log_llm_call(
            route="embed",
            model=settings.OLLAMA_EMBEDDING_MODEL,
            prompt_payload={"model": settings.OLLAMA_EMBEDDING_MODEL, "inputCount": len(texts)},
            completion="",
            prompt_tokens=prompt_tokens,
            completion_tokens=0,
            latency_ms=latency_ms,
            status=status,
            error_msg=error_msg,
            user_id=user_id,
        ))

    return embeddings


async def embed(input: str | list[str], user_id: str | None = None) -> list[list[float]]:
    texts = [input] if isinstance(input, str) else input
    if not texts:
        return []
    out: list[list[float]] = []
    for i in range(0, len(texts), _EMBED_BATCH_SIZE):
        batch = texts[i : i + _EMBED_BATCH_SIZE]
        out.extend(await _embed_batch(batch, user_id))
    return out


async def chat_completion_stream(
    messages: list[OllamaMessage],
    route: str = "chat",
    temperature: float | None = None,
    user_id: str | None = None,
) -> AsyncGenerator[str, None]:
    body: dict = {
        "model": settings.OLLAMA_MODEL,
        "messages": messages,
        "stream": True,
    }
    if temperature is not None:
        body["options"] = {"temperature": temperature}

    t0 = time.monotonic()
    full = ""
    prompt_tokens = 0
    completion_tokens = 0
    status = LlmCallStatus.OK
    error_msg: str | None = None

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=30.0)) as client:
            async with client.stream("POST", f"{settings.OLLAMA_BASE_URL}/api/chat", json=body) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                        content = (chunk.get("message") or {}).get("content", "")
                        if content:
                            full += content
                            yield content
                        if chunk.get("done"):
                            prompt_tokens = chunk.get("prompt_eval_count", 0) or 0
                            completion_tokens = chunk.get("eval_count", 0) or 0
                    except json.JSONDecodeError:
                        pass
    except Exception as exc:
        status = LlmCallStatus.ERROR
        error_msg = str(exc)
        yield f"\n\n⚠️ AI service error: {exc}"
    finally:
        latency_ms = round((time.monotonic() - t0) * 1000)
        if not prompt_tokens:
            prompt_tokens = approx_tokens("\n".join(m.get("content", "") for m in messages))
        if not completion_tokens:
            completion_tokens = approx_tokens(full)
        asyncio.create_task(_log_llm_call(
            route=route,
            model=settings.OLLAMA_MODEL,
            prompt_payload={"model": settings.OLLAMA_MODEL, "messages": messages},
            completion=full,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            latency_ms=latency_ms,
            status=status,
            error_msg=error_msg,
            user_id=user_id,
        ))
