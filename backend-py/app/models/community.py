from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, JSON, String, func
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.enums import CommunityRole


def _new_id() -> str:
    return str(uuid.uuid4())


class Community(Base):
    __tablename__ = "Community"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    name: Mapped[str] = mapped_column(String)
    description: Mapped[str | None] = mapped_column(String, nullable=True)
    course_id: Mapped[str] = mapped_column("courseId", String, ForeignKey("Course.id", ondelete="CASCADE"))
    created_by: Mapped[str] = mapped_column("createdBy", String, ForeignKey("User.id", ondelete="CASCADE"))
    course_code: Mapped[str] = mapped_column("courseCode", String)
    session: Mapped[str] = mapped_column(String)
    department: Mapped[str] = mapped_column(String)
    university: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class CommunityMember(Base):
    __tablename__ = "CommunityMember"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    community_id: Mapped[str] = mapped_column("communityId", String, ForeignKey("Community.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column("userId", String, ForeignKey("User.id", ondelete="CASCADE"))
    role: Mapped[CommunityRole] = mapped_column(
        SAEnum(CommunityRole, name="CommunityRole", create_type=False), default=CommunityRole.STUDENT
    )
    joined_at: Mapped[datetime] = mapped_column("joinedAt", DateTime(timezone=True), server_default=func.now())


class Announcement(Base):
    __tablename__ = "Announcement"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    community_id: Mapped[str] = mapped_column("communityId", String, ForeignKey("Community.id", ondelete="CASCADE"))
    author_id: Mapped[str] = mapped_column("authorId", String, ForeignKey("User.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(String)
    file_url: Mapped[str | None] = mapped_column("fileUrl", String, nullable=True)
    student_feed_only: Mapped[bool] = mapped_column("studentFeedOnly", Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class MarkUpload(Base):
    __tablename__ = "MarkUpload"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    community_id: Mapped[str] = mapped_column("communityId", String, ForeignKey("Community.id", ondelete="CASCADE"))
    uploaded_by: Mapped[str] = mapped_column("uploadedBy", String, ForeignKey("User.id", ondelete="CASCADE"))
    file_url: Mapped[str] = mapped_column("fileUrl", String)
    processed_count: Mapped[int] = mapped_column("processedCount", default=0)
    error_count: Mapped[int] = mapped_column("errorCount", default=0)
    errors: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class Message(Base):
    __tablename__ = "Message"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    sender_id: Mapped[str] = mapped_column("senderId", String, ForeignKey("User.id", ondelete="CASCADE"))
    receiver_id: Mapped[str] = mapped_column("receiverId", String)
    content: Mapped[str] = mapped_column(String)
    file_url: Mapped[str | None] = mapped_column("fileUrl", String, nullable=True)
    is_read: Mapped[bool] = mapped_column("isRead", default=False)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class Thread(Base):
    __tablename__ = "Thread"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    course_id: Mapped[str | None] = mapped_column("courseId", String, ForeignKey("Course.id", ondelete="SET NULL"), nullable=True)
    creator_id: Mapped[str] = mapped_column("creatorId", String, ForeignKey("User.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(String)
    tags: Mapped[list] = mapped_column(ARRAY(String), default=list)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class ThreadPost(Base):
    __tablename__ = "ThreadPost"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    thread_id: Mapped[str] = mapped_column("threadId", String, ForeignKey("Thread.id", ondelete="CASCADE"))
    author_id: Mapped[str] = mapped_column("authorId", String, ForeignKey("User.id", ondelete="CASCADE"))
    content: Mapped[str] = mapped_column(String)
    file_url: Mapped[str | None] = mapped_column("fileUrl", String, nullable=True)
    created_at: Mapped[datetime] = mapped_column("createdAt", DateTime(timezone=True), server_default=func.now())


class ThreadLike(Base):
    __tablename__ = "ThreadLike"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    thread_id: Mapped[str] = mapped_column("threadId", String, ForeignKey("Thread.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column("userId", String, ForeignKey("User.id", ondelete="CASCADE"))
