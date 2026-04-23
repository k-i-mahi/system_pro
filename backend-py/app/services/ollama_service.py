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
            async with httpx.AsyncClient(timeout=120.0) as client:
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
            async with httpx.AsyncClient(timeout=120.0) as client:
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


async def embed(input: str | list[str], user_id: str | None = None) -> list[list[float]]:
    texts = [input] if isinstance(input, str) else input
    if not texts:
        return []

    t0 = time.monotonic()
    status = LlmCallStatus.OK
    error_msg: str | None = None
    embeddings: list[list[float]] = []

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            r = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/embed",
                json={"model": settings.OLLAMA_EMBEDDING_MODEL, "input": texts},
            )
            r.raise_for_status()
            data = r.json()
            embeddings = data.get("embeddings", [])
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
        async with httpx.AsyncClient(timeout=120.0) as client:
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
