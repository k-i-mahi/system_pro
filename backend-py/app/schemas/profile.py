from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, field_validator


class UpdateProfileRequest(BaseModel):
    name: Optional[str] = None
    universityName: Optional[str] = None
    bio: Optional[str] = None
    phone: Optional[str] = None
    rollNumber: Optional[str] = None
    session: Optional[str] = None
    department: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_min(cls, v: str | None) -> str | None:
        if v is not None and len(v) < 2:
            raise ValueError("Must be at least 2 characters")
        return v

    @field_validator("universityName")
    @classmethod
    def university_min(cls, v: str | None) -> str | None:
        if v is not None and len(v) < 3:
            raise ValueError("Must be at least 3 characters")
        return v

    @field_validator("bio")
    @classmethod
    def bio_max(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 500:
            raise ValueError("Must be at most 500 characters")
        return v

    @field_validator("phone")
    @classmethod
    def phone_max(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 20:
            raise ValueError("Must be at most 20 characters")
        return v

    @field_validator("rollNumber")
    @classmethod
    def roll_max(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 30:
            raise ValueError("Must be at most 30 characters")
        return v

    @field_validator("session", "department")
    @classmethod
    def short_text_max(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 80:
            raise ValueError("Must be at most 80 characters")
        return v
