from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class UpdateAttendanceRequest(BaseModel):
    slotId: str
    date: datetime
    present: bool


class UpdateCtScoreRequest(BaseModel):
    enrollmentId: str
    ctScore1: Optional[float] = Field(default=None, ge=0, le=100)
    ctScore2: Optional[float] = Field(default=None, ge=0, le=100)
    ctScore3: Optional[float] = Field(default=None, ge=0, le=100)


class UpdateLabScoreRequest(BaseModel):
    enrollmentId: str
    labScore: float = Field(ge=0, le=100)
