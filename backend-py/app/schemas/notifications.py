from __future__ import annotations

from pydantic import BaseModel, Field


class PaginationQuery(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)


class ClassResponseRequest(BaseModel):
    notificationId: str
    topicCovered: str = Field(min_length=2, max_length=200)
    materialNeeded: bool = False
    materialRequest: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=500)
