from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    topicId: Optional[str] = None
    courseId: Optional[str] = None
    mode: Literal["chat", "quiz", "explain"] = "chat"


class GenerateQuizRequest(BaseModel):
    topicId: str
    questionCount: int = Field(default=5, ge=1, le=20)


class QuizAnswer(BaseModel):
    questionId: str
    selected: str


class QuizQuestion(BaseModel):
    id: str
    question: str
    options: list[str]
    correct: str


class SubmitQuizRequest(BaseModel):
    topicId: str
    answers: list[QuizAnswer]
    questions: list[QuizQuestion]
    timeTaken: int = 0


class AskCourseRequest(BaseModel):
    question: str
    courseId: Optional[str] = None
    topicId: Optional[str] = None
    materialIds: Optional[list[str]] = None
    stream: bool = False
