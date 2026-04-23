from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.models.enums import DateFormat, Role, TimeFormat


def _new_id() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "User"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=_new_id)
    name: Mapped[str] = mapped_column(String)
    email: Mapped[str] = mapped_column(String, unique=True)
    university_name: Mapped[str] = mapped_column("universityName", String)
    password_hash: Mapped[str] = mapped_column("passwordHash", String)
    avatar_url: Mapped[str | None] = mapped_column("avatarUrl", String, nullable=True)
    bio: Mapped[str | None] = mapped_column(String, nullable=True)
    phone: Mapped[str | None] = mapped_column(String, nullable=True)
    roll_number: Mapped[str | None] = mapped_column("rollNumber", String, nullable=True)
    session: Mapped[str | None] = mapped_column(String, nullable=True)
    department: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[Role] = mapped_column(SAEnum(Role, name="Role", create_type=False), default=Role.STUDENT)
    language: Mapped[str] = mapped_column(String, default="en")
    timezone: Mapped[str] = mapped_column(String, default="UTC")
    time_format: Mapped[TimeFormat] = mapped_column(
        "timeFormat", SAEnum(TimeFormat, name="TimeFormat", create_type=False), default=TimeFormat.H24
    )
    date_format: Mapped[DateFormat] = mapped_column(
        "dateFormat", SAEnum(DateFormat, name="DateFormat", create_type=False), default=DateFormat.DMY
    )

    notif_chat: Mapped[bool] = mapped_column("notifChat", Boolean, default=True)
    notif_newest_update: Mapped[bool] = mapped_column("notifNewestUpdate", Boolean, default=True)
    notif_mentor_of_month: Mapped[bool] = mapped_column("notifMentorOfMonth", Boolean, default=False)
    notif_course_of_month: Mapped[bool] = mapped_column("notifCourseOfMonth", Boolean, default=False)

    created_at: Mapped[datetime] = mapped_column(
        "createdAt",
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        "updatedAt",
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
