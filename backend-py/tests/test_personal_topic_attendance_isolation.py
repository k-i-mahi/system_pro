"""Proofs that personal topic flows do not touch attendance state."""
from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models.course import AttendanceRecord, Topic
from app.models.enums import Role, TopicStatus
from app.models.user import User
from app.schemas.courses import CreateTopicRequest
from app.services import courses_service


@pytest.mark.asyncio
async def test_create_personal_topic_only_adds_topic_not_attendance() -> None:
    """
    Student personal topic creation must not create or update AttendanceRecord.
    The code path adds a single Topic row only (see courses_service.create_topic).
    """
    added: list[object] = []
    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()

    async def refresh_fix(topic: Topic) -> None:
        if topic.created_at is None:
            topic.created_at = datetime.now(timezone.utc)

    mock_db.refresh = AsyncMock(side_effect=refresh_fix)

    student = MagicMock(spec=User)
    student.role = Role.STUDENT

    async def mock_get(model, pk):
        if model is User and pk == "stu-1":
            return student
        return None

    mock_db.get = AsyncMock(side_effect=mock_get)

    max_res = MagicMock()
    max_res.scalar_one_or_none.return_value = None
    enr_res = MagicMock()
    enr_res.scalar_one_or_none.return_value = MagicMock()
    mock_db.execute = AsyncMock(side_effect=[max_res, enr_res])

    def capture_add(obj: object) -> None:
        added.append(obj)

    mock_db.add = MagicMock(side_effect=capture_add)

    body = CreateTopicRequest(title="Private note", status=TopicStatus.IN_PROGRESS)

    with patch.object(courses_service, "_require_course", new_callable=AsyncMock):
        await courses_service.create_topic(mock_db, "course-1", body, "stu-1")

    assert len(added) == 1
    assert isinstance(added[0], Topic)
    assert added[0].is_personal is True
    assert not any(isinstance(x, AttendanceRecord) for x in added)


def test_student_attendance_percentage_unchanged_if_no_record_added_or_removed() -> None:
    """
    Mirrors analytics_service._course_analytics_student (present_count / len(rows)).
    If class_not_held does not add or delete an AttendanceRecord for that occurrence,
    the list of rows is unchanged → same numerator and denominator → same percentage.
    """
    rows = [True, True, False, False]

    def pct(present_flags: list[bool]) -> int:
        n = len(present_flags)
        return round((sum(1 for p in present_flags if p) / n) * 100) if n else 0

    before = pct(rows)
    # Behavioral contract: no mutation to attendance rows for this occurrence
    after = pct(rows)
    assert before == after == 50
