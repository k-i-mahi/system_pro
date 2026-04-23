from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import MaterialType, OcrQuality, TopicStatus


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
    title: str | None = None
    description: str | None = None
    weekNumber: int | None = None
    sessionDate: datetime | None = None
    orderIndex: int | None = None
    status: TopicStatus | None = None


class ReorderTopicsRequest(BaseModel):
    topicIds: list[str]


class AddMaterialLinkRequest(BaseModel):
    title: str
    fileUrl: str
