from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, JSON, String, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import (
    IngestStatus, LlmCallStatus, NotificationType, OcrQuality, ScanStatus, TutorStrategy
)


def _new_id() -> str:
    return str(uuid.uuid4())


class Notification(Base):
    __tablename__ = "Notification"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column("userId", String, ForeignKey("User.id", ondelete="CASCADE"))
    type: Mapped[NotificationType] = mapped_column(
        SAEnum(NotificationType, name="NotificationType", create_type=False)
    )
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(String)
    is_read: Mapped[bool] = mapped_column("isRead", Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)


class Embedding(Base):
    __tablename__ = "Embedding"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    material_id: Mapped[str] = mapped_column("materialId", String, ForeignKey("Material.id", ondelete="CASCADE"))
    chunk_index: Mapped[int] = mapped_column("chunkIndex", Integer)
    content: Mapped[str] = mapped_column(String)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    heading: Mapped[str | None] = mapped_column(String, nullable=True)
    token_count: Mapped[int] = mapped_column("tokenCount", Integer, default=0)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())
    # embedding vector(768) and tsv tsvector columns are accessed via raw SQL only


class LlmCall(Base):
    __tablename__ = "LlmCall"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str | None] = mapped_column("userId", String, ForeignKey("User.id", ondelete="SET NULL"), nullable=True)
    route: Mapped[str] = mapped_column(String)
    model: Mapped[str] = mapped_column(String)
    strategy: Mapped[TutorStrategy | None] = mapped_column(
        SAEnum(TutorStrategy, name="TutorStrategy", create_type=False), nullable=True
    )
    tool_name: Mapped[str | None] = mapped_column("toolName", String, nullable=True)
    prompt: Mapped[dict] = mapped_column(JSON)
    completion: Mapped[str] = mapped_column(String)
    tool_calls: Mapped[dict | None] = mapped_column("toolCalls", JSON, nullable=True)
    prompt_tokens: Mapped[int] = mapped_column("promptTokens", Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column("completionTokens", Integer, default=0)
    latency_ms: Mapped[int] = mapped_column("latencyMs", Integer, default=0)
    cost_usd: Mapped[float] = mapped_column("costUsd", Float, default=0.0)
    parent_call_id: Mapped[str | None] = mapped_column("parentCallId", String, ForeignKey("LlmCall.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[LlmCallStatus] = mapped_column(
        SAEnum(LlmCallStatus, name="LlmCallStatus", create_type=False), default=LlmCallStatus.OK
    )
    error_msg: Mapped[str | None] = mapped_column("errorMsg", String, nullable=True)
    metadata_: Mapped[dict | None] = mapped_column("metadata", JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class RoutineScan(Base):
    __tablename__ = "RoutineScan"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column("userId", String, ForeignKey("User.id", ondelete="CASCADE"))
    file_url: Mapped[str] = mapped_column("fileUrl", String)
    extracted_text: Mapped[str] = mapped_column("extractedText", String)
    parsed_codes: Mapped[list] = mapped_column("parsedCodes", ARRAY(String))
    status: Mapped[ScanStatus] = mapped_column(
        SAEnum(ScanStatus, name="ScanStatus", create_type=False), default=ScanStatus.PENDING
    )
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class QuestionBank(Base):
    __tablename__ = "QuestionBank"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    topic_id: Mapped[str] = mapped_column("topicId", String)
    question: Mapped[str] = mapped_column(String)
    options: Mapped[list] = mapped_column(JSON)
    correct: Mapped[str] = mapped_column(String)
    explanation: Mapped[str | None] = mapped_column(String, nullable=True)
    difficulty: Mapped[int] = mapped_column(Integer, default=3)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())
    source: Mapped[str] = mapped_column(String, default="llm")


class StudySession(Base):
    __tablename__ = "StudySession"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column("userId", String, ForeignKey("User.id", ondelete="CASCADE"))
    cohort: Mapped[str] = mapped_column(String, default="pilot")
    pre_test: Mapped[dict | None] = mapped_column("preTest", JSON, nullable=True)
    post_test: Mapped[dict | None] = mapped_column("postTest", JSON, nullable=True)
    sus_score: Mapped[float | None] = mapped_column("susScore", Float, nullable=True)
    nps_score: Mapped[int | None] = mapped_column("npsScore", Integer, nullable=True)
    notes: Mapped[str | None] = mapped_column(String, nullable=True)
    started_at: Mapped[datetime] = mapped_column("startedAt", DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column("completedAt", DateTime(timezone=True), nullable=True)
