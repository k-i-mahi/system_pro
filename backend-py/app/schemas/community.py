from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field, HttpUrl, field_validator


class CreateThreadRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1)
    courseId: Optional[str] = None
    tags: list[str] = Field(default_factory=list)


class CreatePostRequest(BaseModel):
    content: str = Field(min_length=1)
    fileUrl: Optional[str] = None


class CreateCommunityRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: Optional[str] = None
    courseCode: str = Field(min_length=2)
    session: str = Field(min_length=1)
    department: str = Field(min_length=1)
    university: str = Field(min_length=1)


class JoinCommunityRequest(BaseModel):
    rollNumber: str = Field(min_length=1)
    session: str = Field(min_length=1)
    department: str = Field(min_length=1)


class CreateAnnouncementRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1)
    fileUrl: Optional[str] = None


class AttendanceRecord(BaseModel):
    userId: str
    present: bool


class RecordAttendanceRequest(BaseModel):
    slotId: str = Field(min_length=1)
    date: str = Field(min_length=1)
    records: list[AttendanceRecord] = Field(min_length=1)
