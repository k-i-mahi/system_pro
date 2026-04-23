from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, field_validator

from app.models.enums import DayOfWeek, SlotType

_TIME_RE = re.compile(r"^\d{2}:\d{2}$")


class SlotInput(BaseModel):
    dayOfWeek: DayOfWeek
    startTime: str
    endTime: str
    type: SlotType = SlotType.CLASS
    room: str | None = None

    @field_validator("startTime", "endTime")
    @classmethod
    def validate_time(cls, v: str) -> str:
        if not _TIME_RE.match(v):
            raise ValueError("Time must be HH:MM")
        return v


class BulkCourseInput(BaseModel):
    courseCode: str
    courseName: str
    slots: list[SlotInput]

    @field_validator("courseCode", "courseName")
    @classmethod
    def min_two(cls, v: str) -> str:
        if len(v) < 2:
            raise ValueError("Must be at least 2 characters")
        return v


class BulkCreateCoursesRequest(BaseModel):
    courses: list[BulkCourseInput]


class UpdateSlotRequest(BaseModel):
    dayOfWeek: DayOfWeek | None = None
    startTime: str | None = None
    endTime: str | None = None
    type: SlotType | None = None
    room: str | None = None

    @field_validator("startTime", "endTime")
    @classmethod
    def validate_time(cls, v: str | None) -> str | None:
        if v is not None and not _TIME_RE.match(v):
            raise ValueError("Time must be HH:MM")
        return v


class MoveSlotRequest(BaseModel):
    dayOfWeek: DayOfWeek
    resolveConflicts: Literal["override", "shift", "swap"] | None = None
