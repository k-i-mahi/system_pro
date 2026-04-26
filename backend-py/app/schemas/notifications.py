from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class PaginationQuery(BaseModel):
    page: int = Field(default=1, ge=1)
    limit: int = Field(default=20, ge=1, le=100)


class ClassResponseRequest(BaseModel):
    notificationId: str
    action: Literal['attended', 'missed'] = 'attended'
    topicCovered: str | None = Field(default=None, max_length=200)
    materialNeeded: bool = False
    materialRequest: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=500)

    @model_validator(mode='after')
    def validate_topic_for_attended(self) -> 'ClassResponseRequest':
        if self.action == 'attended':
            topic = (self.topicCovered or '').strip()
            if len(topic) < 2:
                raise ValueError('topicCovered must be at least 2 characters when action is "attended"')
        return self
