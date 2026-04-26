from __future__ import annotations

import re
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.models.enums import Role


class AdminCreateUserRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str
    password: str = Field(min_length=8, max_length=128)
    universityName: str = Field(min_length=3, max_length=200)
    role: Role = Role.STUDENT
    rollNumber: Optional[str] = None
    session: Optional[str] = None
    department: Optional[str] = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str) -> str:
        email = v.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("Invalid email address")
        return email

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain an uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain a number")
        return v


class AdminUpdateUserRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=120)
    email: Optional[str] = None
    universityName: Optional[str] = Field(default=None, min_length=3, max_length=200)
    role: Optional[Role] = None
    rollNumber: Optional[str] = None
    session: Optional[str] = None
    department: Optional[str] = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, v: str | None) -> str | None:
        if v is None:
            return None
        email = v.strip().lower()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("Invalid email address")
        return email


class AdminDeleteUserRequest(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=500)


class AdminCreateCommunityRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    courseCode: str = Field(min_length=2, max_length=30)
    session: str = Field(min_length=1, max_length=50)
    department: str = Field(min_length=1, max_length=120)
    university: str = Field(min_length=1, max_length=200)


class AdminUpdateCommunityRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    courseCode: Optional[str] = Field(default=None, min_length=2, max_length=30)
    session: Optional[str] = Field(default=None, min_length=1, max_length=50)
    department: Optional[str] = Field(default=None, min_length=1, max_length=120)
    university: Optional[str] = Field(default=None, min_length=1, max_length=200)
