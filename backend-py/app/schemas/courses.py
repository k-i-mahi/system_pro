from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import TopicStatus


class CoursesQuery(BaseModel):
    search: str | None = None
    level: str | None = None
    category: str | None = None
    sort: Literal["az", "za", "popular"] | None = None
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=12, ge=1, le=50)


class CreateTopicRequest(BaseModel):
    title: str = Field(min_length=1)
    description: str | None = None
    weekNumber: int | None = None
    sessionDate: datetime | None = None
    orderIndex: int | None = None
    status: TopicStatus = TopicStatus.NOT_STARTED


class UpdateTopicRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    description: str | None = None
    weekNumber: int | None = None
    sessionDate: datetime | None = None
    orderIndex: int | None = None
    status: TopicStatus | None = None


class ReorderTopicsRequest(BaseModel):
    topicIds: list[str]


class AddMaterialLinkRequest(BaseModel):
    title: str = Field(min_length=1)
    fileUrl: str
    weekNumber: int | None = Field(default=None, ge=1, le=52)


class UpdateMaterialRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    fileUrl: str | None = None
    weekNumber: int | None = Field(default=None, ge=1, le=52)


class PatchMyLabMarksBody(BaseModel):
    """Partial update: only keys present in the JSON body are applied. Use null to clear a mark."""

    model_config = ConfigDict(extra="forbid")

    labTest: float | None = Field(default=None, ge=0, le=20)
    labQuiz: float | None = Field(default=None, ge=0, le=20)
    assignment: float | None = Field(default=None, ge=0, le=40)


class PatchMyTheoryMarksBody(BaseModel):
    """Student-owned theory marks (manual entry). Use null to clear."""

    model_config = ConfigDict(extra="forbid")

    classTest1: float | None = Field(default=None, ge=0, le=20)
    classTest2: float | None = Field(default=None, ge=0, le=20)
    classTest3: float | None = Field(default=None, ge=0, le=20)
    assignment: float | None = Field(default=None, ge=0, le=40)
