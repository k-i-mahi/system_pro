from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, Float, ForeignKey, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import CourseType, DayOfWeek, IngestStatus, MaterialType, OcrQuality, SlotType, TopicStatus


def _new_id() -> str:
    return str(uuid.uuid4())


class Course(Base):
    __tablename__ = "Course"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    course_code: Mapped[str] = mapped_column("courseCode", String)
    course_name: Mapped[str] = mapped_column("courseName", String)
    course_type: Mapped[CourseType] = mapped_column(
        "courseType", SAEnum(CourseType, name="CourseType", create_type=False), default=CourseType.THEORY
    )
    category: Mapped[str | None] = mapped_column(String, nullable=True)
    level: Mapped[str] = mapped_column(String, default="Beginner")
    thumbnail: Mapped[str | None] = mapped_column(String, nullable=True)
    duration: Mapped[str | None] = mapped_column(String, nullable=True)
    rating: Mapped[float] = mapped_column(Float, default=0.0)
    student_count: Mapped[int] = mapped_column("studentCount", Integer, default=0)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class Enrollment(Base):
    __tablename__ = "Enrollment"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column("userId", String, ForeignKey("User.id", ondelete="CASCADE"))
    course_id: Mapped[str] = mapped_column("courseId", String, ForeignKey("Course.id", ondelete="CASCADE"))
    ct_score1: Mapped[float | None] = mapped_column("ctScore1", Float, nullable=True)
    ct_score2: Mapped[float | None] = mapped_column("ctScore2", Float, nullable=True)
    ct_score3: Mapped[float | None] = mapped_column("ctScore3", Float, nullable=True)
    lab_score: Mapped[float | None] = mapped_column("labScore", Float, nullable=True)


class ScheduleSlot(Base):
    __tablename__ = "ScheduleSlot"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    course_id: Mapped[str] = mapped_column("courseId", String, ForeignKey("Course.id", ondelete="CASCADE"))
    day_of_week: Mapped[DayOfWeek] = mapped_column(
        "dayOfWeek", SAEnum(DayOfWeek, name="DayOfWeek", create_type=False)
    )
    start_time: Mapped[str] = mapped_column("startTime", String)
    end_time: Mapped[str] = mapped_column("endTime", String)
    type: Mapped[SlotType] = mapped_column(SAEnum(SlotType, name="SlotType", create_type=False), default=SlotType.CLASS)
    room: Mapped[str | None] = mapped_column(String, nullable=True)


class Topic(Base):
    __tablename__ = "Topic"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    course_id: Mapped[str] = mapped_column("courseId", String, ForeignKey("Course.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    week_number: Mapped[int | None] = mapped_column("weekNumber", Integer, nullable=True)
    session_date: Mapped[datetime | None] = mapped_column("sessionDate", DateTime(timezone=True), nullable=True)
    order_index: Mapped[int] = mapped_column("orderIndex", Integer, default=0)
    status: Mapped[TopicStatus] = mapped_column(
        SAEnum(TopicStatus, name="TopicStatus", create_type=False), default=TopicStatus.NOT_STARTED
    )
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class Material(Base):
    __tablename__ = "Material"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    topic_id: Mapped[str] = mapped_column("topicId", String, ForeignKey("Topic.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String)
    file_url: Mapped[str] = mapped_column("fileUrl", String)
    file_type: Mapped[MaterialType] = mapped_column(
        "fileType", SAEnum(MaterialType, name="MaterialType", create_type=False)
    )
    public_id: Mapped[str | None] = mapped_column("publicId", String, nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column("uploadedAt", DateTime(timezone=True), server_default=func.now())
    has_embeddings: Mapped[bool] = mapped_column("hasEmbeddings", Boolean, default=False)
    ingest_status: Mapped[IngestStatus] = mapped_column(
        "ingestStatus", SAEnum(IngestStatus, name="IngestStatus", create_type=False), default=IngestStatus.PENDING
    )
    ingest_error: Mapped[str | None] = mapped_column("ingestError", String, nullable=True)
    chunk_count: Mapped[int] = mapped_column("chunkCount", Integer, default=0)
    ocr_quality: Mapped[OcrQuality] = mapped_column(
        "ocrQuality", SAEnum(OcrQuality, name="OcrQuality", create_type=False), default=OcrQuality.FAST
    )


class TopicProgress(Base):
    __tablename__ = "TopicProgress"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column("userId", String, ForeignKey("User.id", ondelete="CASCADE"))
    topic_id: Mapped[str] = mapped_column("topicId", String, ForeignKey("Topic.id", ondelete="CASCADE"))
    expertise_level: Mapped[float] = mapped_column("expertiseLevel", Float, default=0.0)
    study_minutes: Mapped[int] = mapped_column("studyMinutes", Integer, default=0)
    exam_score: Mapped[float | None] = mapped_column("examScore", Float, nullable=True)
    last_studied: Mapped[datetime | None] = mapped_column("lastStudied", DateTime(timezone=True), nullable=True)
    alpha: Mapped[float] = mapped_column(Float, default=1.0)
    beta: Mapped[float] = mapped_column(Float, default=1.0)


class AttendanceRecord(Base):
    __tablename__ = "AttendanceRecord"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    user_id: Mapped[str] = mapped_column("userId", String, ForeignKey("User.id", ondelete="CASCADE"))
    slot_id: Mapped[str] = mapped_column("slotId", String, ForeignKey("ScheduleSlot.id", ondelete="CASCADE"))
    date: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    present: Mapped[bool] = mapped_column(Boolean, default=False)
