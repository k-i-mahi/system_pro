from __future__ import annotations

import json
import math
from typing import AsyncGenerator

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError
from app.models.course import Course, Topic, TopicProgress
from app.models.misc import ExamAttempt
from app.services import ollama_service, search_service
from app.services.rag.answer import answer_with_citations, stream_answer_with_citations
from app.services.rag.retriever import RetrievalScope

QUIZ_SCHEMA = {
    "type": "object",
    "properties": {
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "question": {"type": "string"},
                    "options": {"type": "array", "items": {"type": "string"}, "minItems": 4, "maxItems": 4},
                    "correct": {"type": "string", "enum": ["A", "B", "C", "D"]},
                    "explanation": {"type": "string"},
                    "difficulty": {"type": "integer", "minimum": 1, "maximum": 5},
                },
                "required": ["id", "question", "options", "correct"],
            },
        }
    },
    "required": ["questions"],
}


def _beta_ci(alpha: float, beta: float, level: float = 0.95) -> tuple[float, float]:
    mean = alpha / (alpha + beta)
    variance = (alpha * beta) / ((alpha + beta) ** 2 * (alpha + beta + 1))
    sd = math.sqrt(variance)
    z = 1.96 if level == 0.95 else (1.645 if level == 0.9 else 2.576)
    return max(0.0, mean - z * sd), min(1.0, mean + z * sd)


async def stream_chat(
    db: AsyncSession,
    user_id: str,
    messages: list[dict],
    topic_id: str | None,
    course_id: str | None,
    mode: str,
) -> AsyncGenerator[str, None]:
    course_name: str | None = None
    topic_title: str | None = None

    if course_id:
        course = await db.get(Course, course_id)
        course_name = course.course_name if course else None
    if topic_id:
        topic = await db.get(Topic, topic_id)
        if topic:
            topic_title = topic.title
            if not course_name:
                course = await db.get(Course, topic.course_id)
                if course:
                    course_name = course.course_name

    system_prompt = ollama_service.build_system_prompt(course_name, topic_title)
    mode_instruction = ""
    if mode == "explain":
        mode_instruction = "\nExplain the topic in detail with examples."
    elif mode == "quiz":
        mode_instruction = "\nGenerate quiz questions in strict JSON format."

    full_messages = [{"role": "system", "content": system_prompt + mode_instruction}] + messages

    try:
        async for chunk in ollama_service.chat_completion_stream(full_messages, route="tutor.chat", user_id=user_id):
            yield f"data: {json.dumps({'content': chunk})}\n\n"
    except Exception as exc:
        conn_refused = "ECONNREFUSED" in str(exc) or "Connection refused" in str(exc)
        msg = (
            "AI service (Ollama) is not running. Please start it and try again."
            if conn_refused
            else f"AI service error: {exc}"
        )
        yield f"data: {json.dumps({'content': f'⚠️ {msg}'})}\n\n"

    if topic_id:
        existing = (await db.execute(
            select(TopicProgress).where(TopicProgress.user_id == user_id, TopicProgress.topic_id == topic_id)
        )).scalar_one_or_none()
        from datetime import datetime, timezone
        now = datetime.now(timezone.utc)
        if existing:
            existing.study_minutes = (existing.study_minutes or 0) + 1
            existing.last_studied = now
        else:
            db.add(TopicProgress(user_id=user_id, topic_id=topic_id, study_minutes=1, last_studied=now))
        await db.commit()

    yield "data: [DONE]\n\n"


async def generate_quiz(db: AsyncSession, user_id: str, topic_id: str, question_count: int) -> dict:
    topic = await db.get(Topic, topic_id)
    if not topic:
        raise NotFoundError("Topic not found")
    course = await db.get(Course, topic.course_id)
    course_name = course.course_name if course else topic.course_id

    target_difficulty = 3
    progress = (await db.execute(
        select(TopicProgress).where(TopicProgress.user_id == user_id, TopicProgress.topic_id == topic_id)
    )).scalar_one_or_none()
    if progress:
        mean = progress.alpha / (progress.alpha + progress.beta)
        target_difficulty = max(1, min(5, round(1 + mean * 4)))

    prompt = (
        f'Generate exactly {question_count} multiple choice questions about "{topic.title}" for the course "{course_name}".\n'
        f"Target difficulty: {target_difficulty}/5 (calibrated to the student's current mastery).\n"
        'Each question must have exactly 4 options labelled "A) ...", "B) ...", "C) ...", "D) ...".\n'
        'Include a 1-sentence "explanation" of why the correct answer is right.'
    )

    system = ollama_service.build_system_prompt(course_name, topic.title)
    try:
        parsed = await ollama_service.chat_completion_structured(
            [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            QUIZ_SCHEMA,
            route="tutor.generate-quiz",
            temperature=0.4,
            user_id=user_id,
        )
        if not parsed or not parsed.get("questions"):
            raise ValidationError("Quiz generation returned no questions", code="AI_ERROR")
        return parsed
    except ValidationError:
        raise
    except Exception as exc:
        raise ValidationError(f"Failed to generate quiz: {exc}", code="AI_ERROR")


async def submit_quiz(
    db: AsyncSession,
    user_id: str,
    topic_id: str,
    answers: list[dict],
    questions: list[dict],
    time_taken: int,
) -> dict:
    correct = 0
    breakdown = []
    for q in questions:
        user_answer = next((a["selected"] for a in answers if a["questionId"] == q["id"]), None)
        is_correct = user_answer == q["correct"]
        if is_correct:
            correct += 1
        breakdown.append({"questionId": q["id"], "question": q["question"], "correct": q["correct"], "userAnswer": user_answer, "isCorrect": is_correct})

    incorrect = len(questions) - correct
    score = correct / len(questions) if questions else 0

    attempt = ExamAttempt(
        user_id=user_id,
        topic_id=topic_id,
        questions=questions,
        score=score * 100,
        total_q=len(questions),
        time_taken=time_taken,
    )
    db.add(attempt)
    await db.flush()

    progress = (await db.execute(
        select(TopicProgress).where(TopicProgress.user_id == user_id, TopicProgress.topic_id == topic_id)
    )).scalar_one_or_none()

    if progress:
        progress.alpha = (progress.alpha or 1.0) + correct
        progress.beta = (progress.beta or 1.0) + incorrect
        progress.exam_score = score * 100
        new_alpha, new_beta = progress.alpha, progress.beta
    else:
        new_alpha = 1.0 + correct
        new_beta = 1.0 + incorrect
        progress = TopicProgress(
            user_id=user_id,
            topic_id=topic_id,
            alpha=new_alpha,
            beta=new_beta,
            expertise_level=new_alpha / (new_alpha + new_beta),
            exam_score=score * 100,
        )
        db.add(progress)

    mean = new_alpha / (new_alpha + new_beta)
    progress.expertise_level = mean
    await db.commit()

    lower, upper = _beta_ci(new_alpha, new_beta)
    posterior = {"alpha": new_alpha, "beta": new_beta, "mean": mean, "lower": lower, "upper": upper}

    return {
        "attemptId": attempt.id,
        "score": correct,
        "total": len(questions),
        "percentage": round(score * 100),
        "breakdown": breakdown,
        "posterior": posterior,
    }


async def search_resources(query: str, type: str | None, limit: int) -> list[dict]:
    return await search_service.search_web(query, type, limit)


async def ask_course(
    db: AsyncSession,
    user_id: str,
    question: str,
    course_id: str | None,
    topic_id: str | None,
    material_ids: list[str] | None,
    stream: bool,
):
    if not question or len(question.strip()) < 3:
        raise ValidationError("Please provide a question of at least 3 characters", code="BAD_QUESTION")

    if course_id:
        course = await db.get(Course, course_id)
        if not course:
            raise NotFoundError("Course not found")

    scope = RetrievalScope(course_id=course_id, topic_id=topic_id, material_ids=material_ids, user_id=user_id)

    if stream:
        return stream_answer_with_citations(db, question, scope, user_id=user_id)

    result = await answer_with_citations(db, question, scope, user_id=user_id)
    return {
        "answer": result.answer,
        "citations": [
            {
                "index": c.index, "materialId": c.material_id, "materialTitle": c.material_title,
                "page": c.page, "heading": c.heading, "snippet": c.snippet,
            }
            for c in result.citations
        ],
        "chunkCount": len(result.chunks),
    }
