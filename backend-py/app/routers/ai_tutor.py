from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from app.core.deps import CurrentUserIdDep, DBDep, get_current_user_id
from app.core.response import success
from app.schemas.ai_tutor import AskCourseRequest, ChatRequest, GenerateQuizRequest, SubmitQuizRequest
from app.services import ai_tutor_service

router = APIRouter(dependencies=[Depends(get_current_user_id)])


@router.post("/chat")
async def chat(body: ChatRequest, db: DBDep, user_id: CurrentUserIdDep):
    messages = [{"role": m.role, "content": m.content} for m in body.messages]
    return StreamingResponse(
        ai_tutor_service.stream_chat(db, user_id, messages, body.topicId, body.courseId, body.mode),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )


@router.post("/generate-quiz")
async def generate_quiz(body: GenerateQuizRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await ai_tutor_service.generate_quiz(db, user_id, body.topicId, body.questionCount)
    return success(data)


@router.post("/submit-quiz")
async def submit_quiz(body: SubmitQuizRequest, db: DBDep, user_id: CurrentUserIdDep):
    answers = [{"questionId": a.questionId, "selected": a.selected} for a in body.answers]
    questions = [{"id": q.id, "question": q.question, "options": q.options, "correct": q.correct} for q in body.questions]
    data = await ai_tutor_service.submit_quiz(db, user_id, body.topicId, answers, questions, body.timeTaken)
    return success(data)


@router.get("/search-resources")
async def search_resources(
    query: str, user_id: CurrentUserIdDep,
    type: Optional[str] = None, limit: int = 10,
):
    data = await ai_tutor_service.search_resources(query, type, limit)
    return success(data)


@router.post("/ask-course")
async def ask_course(body: AskCourseRequest, db: DBDep, user_id: CurrentUserIdDep):
    result = await ai_tutor_service.ask_course(
        db, user_id, body.question, body.courseId, body.topicId, body.materialIds, body.stream
    )
    if body.stream:
        return StreamingResponse(
            result,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache, no-transform", "Connection": "keep-alive"},
        )
    return success(result)
