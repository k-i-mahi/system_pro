from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel, field_validator

from app.models.enums import DateFormat, TimeFormat


class UpdateGeneralRequest(BaseModel):
    language: Optional[str] = None
    timezone: Optional[str] = None
    timeFormat: Optional[TimeFormat] = None
    dateFormat: Optional[DateFormat] = None


class UpdatePasswordRequest(BaseModel):
    oldPassword: str
    newPassword: str

    @field_validator("newPassword")
    @classmethod
    def password_strong(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Must be at least 8 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Must contain an uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Must contain a number")
        return v


class UpdateNotificationsRequest(BaseModel):
    notifChat: Optional[bool] = None
    notifNewestUpdate: Optional[bool] = None
    notifMentorOfMonth: Optional[bool] = None
    notifCourseOfMonth: Optional[bool] = None
