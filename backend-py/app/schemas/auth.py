from __future__ import annotations

import re

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.models.enums import DateFormat, Role, TimeFormat

_STUDENT_EMAIL_RE = re.compile(r"^[a-z]+[0-9]+@stud\.kuet\.ac\.bd$")
_TUTOR_EMAIL_RE = re.compile(r"^[a-z]+@[a-z]+\.kuet\.ac\.bd$")
_KUET_EDU_EMAIL_RE = re.compile(r"^[a-z]+([0-9]+)?@([a-z]+\.kuet\.ac\.bd|stud\.kuet\.ac\.bd)$")

# ── Requests ──────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    universityName: str
    name: str
    email: str
    password: str
    role: Role = Role.STUDENT
    @field_validator("email")
    @classmethod
    def email_format(cls, v: str) -> str:
        email = v.strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("Only verified educational mail is allowed")
        return email.lower()


    @field_validator("universityName")
    @classmethod
    def university_name_min_length(cls, v: str) -> str:
        if len(v) < 3:
            raise ValueError("University name must be at least 3 characters")
        return v

    @field_validator("name")
    @classmethod
    def name_min_length(cls, v: str) -> str:
        if len(v) < 2:
            raise ValueError("Name must be at least 2 characters")
        return v

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Password cannot be empty")
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number")
        return v

    @field_validator("role")
    @classmethod
    def role_allowed(cls, v: Role) -> Role:
        if v not in (Role.STUDENT, Role.TUTOR):
            raise ValueError("Registration is only available for STUDENT and TUTOR roles")
        return v

    @model_validator(mode="after")
    def role_email_rules(self) -> "RegisterRequest":
        email = (self.email or "").lower().strip()
        if self.role == Role.STUDENT and not _STUDENT_EMAIL_RE.match(email):
            raise ValueError("Only verified educational mail is allowed")
        if self.role == Role.TUTOR and not _TUTOR_EMAIL_RE.match(email):
            raise ValueError("Only verified educational mail is allowed")
        return self


class LoginRequest(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def email_format(cls, v: str) -> str:
        email = v.strip()
        if not _KUET_EDU_EMAIL_RE.match(email.lower()):
            raise ValueError("Only verified educational mail is allowed")
        return email.lower()

    @field_validator("password")
    @classmethod
    def password_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Password cannot be empty")
        return v


class RefreshRequest(BaseModel):
    refreshToken: str


class ForgotPasswordRequest(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def email_format(cls, v: str) -> str:
        email = v.strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("Invalid email address")
        return email.lower()


class VerifyOtpRequest(BaseModel):
    email: str
    otp: str

    @field_validator("email")
    @classmethod
    def email_format(cls, v: str) -> str:
        email = v.strip()
        if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
            raise ValueError("Invalid email address")
        return email.lower()

    @field_validator("otp")
    @classmethod
    def otp_length(cls, v: str) -> str:
        if len(v) != 4:
            raise ValueError("OTP must be exactly 4 characters")
        return v


class ResetPasswordRequest(BaseModel):
    token: str
    newPassword: str

    @field_validator("newPassword")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one number")
        return v


# ── Responses ─────────────────────────────────────────────────────────────────

class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: str
    universityName: str
    role: Role
    avatarUrl: str | None = None
    rollNumber: str | None = None
    session: str | None = None
    department: str | None = None

    # Map snake_case model attributes → camelCase JSON (match Express API contract)
    @classmethod
    def from_orm_user(cls, u: object) -> "UserPublic":
        return cls(
            id=u.id,  # type: ignore[attr-defined]
            name=u.name,  # type: ignore[attr-defined]
            email=u.email,  # type: ignore[attr-defined]
            universityName=u.university_name,  # type: ignore[attr-defined]
            role=u.role,  # type: ignore[attr-defined]
            avatarUrl=u.avatar_url,  # type: ignore[attr-defined]
            rollNumber=u.roll_number,  # type: ignore[attr-defined]
            session=u.session,  # type: ignore[attr-defined]
            department=u.department,  # type: ignore[attr-defined]
        )


class UserFull(BaseModel):
    """Used by GET /me — returns all profile fields."""
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    email: str
    universityName: str
    role: Role
    avatarUrl: str | None = None
    bio: str | None = None
    phone: str | None = None
    rollNumber: str | None = None
    session: str | None = None
    department: str | None = None
    language: str
    timezone: str
    timeFormat: TimeFormat
    dateFormat: DateFormat
    notifChat: bool
    notifNewestUpdate: bool
    notifMentorOfMonth: bool
    notifCourseOfMonth: bool
    createdAt: str

    @classmethod
    def from_orm_user(cls, u: object) -> "UserFull":
        return cls(
            id=u.id,  # type: ignore[attr-defined]
            name=u.name,  # type: ignore[attr-defined]
            email=u.email,  # type: ignore[attr-defined]
            universityName=u.university_name,  # type: ignore[attr-defined]
            role=u.role,  # type: ignore[attr-defined]
            avatarUrl=u.avatar_url,  # type: ignore[attr-defined]
            bio=u.bio,  # type: ignore[attr-defined]
            phone=u.phone,  # type: ignore[attr-defined]
            rollNumber=u.roll_number,  # type: ignore[attr-defined]
            session=u.session,  # type: ignore[attr-defined]
            department=u.department,  # type: ignore[attr-defined]
            language=u.language,  # type: ignore[attr-defined]
            timezone=u.timezone,  # type: ignore[attr-defined]
            timeFormat=u.time_format,  # type: ignore[attr-defined]
            dateFormat=u.date_format,  # type: ignore[attr-defined]
            notifChat=u.notif_chat,  # type: ignore[attr-defined]
            notifNewestUpdate=u.notif_newest_update,  # type: ignore[attr-defined]
            notifMentorOfMonth=u.notif_mentor_of_month,  # type: ignore[attr-defined]
            notifCourseOfMonth=u.notif_course_of_month,  # type: ignore[attr-defined]
            createdAt=u.created_at.isoformat(),  # type: ignore[attr-defined]
        )
