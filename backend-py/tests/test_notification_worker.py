"""Tests for notification worker idempotency, dedup, and gap-fill logic."""
from __future__ import annotations

import pytest
import pytest_asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

from app.models.enums import NotificationType


@pytest.mark.asyncio
async def test_create_notification_dedup(mocker) -> None:
    """create_notification skips if notificationKey already exists for user."""
    from app.services import notification_service

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = "existing-id"
    mock_db.execute = AsyncMock(return_value=mock_result)

    result = await notification_service.create_notification(
        db=mock_db,
        user_id="user-1",
        type=NotificationType.CLASS_REMINDER,
        title="Test",
        body="Test body",
        metadata={"notificationKey": "student:2025-01-01:slot-1"},
    )

    assert result is None
    mock_db.add.assert_not_called()


@pytest.mark.asyncio
async def test_create_notification_no_key_creates(mocker) -> None:
    """create_notification creates when no notificationKey in metadata."""
    from app.services import notification_service

    mock_db = AsyncMock()
    mock_db.flush = AsyncMock()

    # Patch socket emit to avoid actual socket connection
    with patch("app.core.socket.sio") as mock_sio:
        mock_sio.emit = AsyncMock()
        mock_result = MagicMock()
        mock_result.scalar_one.return_value = 1
        mock_db.execute = AsyncMock(return_value=mock_result)

        result = await notification_service.create_notification(
            db=mock_db,
            user_id="user-1",
            type=NotificationType.ANNOUNCEMENT,
            title="New Announcement",
            body="Hello",
        )

    mock_db.add.assert_called_once()


@pytest.mark.asyncio
async def test_delete_reminder_soft_deletes(mocker) -> None:
    """delete_notification soft-deletes CLASS_REMINDER instead of hard-deleting."""
    from app.services import notifications_service
    from app.models.enums import NotificationType

    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()

    notif = MagicMock()
    notif.id = "notif-1"
    notif.user_id = "user-1"
    notif.type = NotificationType.CLASS_REMINDER
    notif.metadata_ = {"slotId": "slot-1"}
    notif.is_read = False

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = notif
    mock_db.execute = AsyncMock(return_value=mock_result)

    await notifications_service.delete_notification(mock_db, "notif-1", "user-1")

    assert notif.metadata_.get("deletedByUser") is True
    assert notif.is_read is True
    mock_db.delete.assert_not_called()
    mock_db.commit.assert_called_once()


@pytest.mark.asyncio
async def test_delete_non_reminder_hard_deletes(mocker) -> None:
    """delete_notification hard-deletes non-reminder notifications."""
    from app.services import notifications_service
    from app.models.enums import NotificationType

    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_db.delete = AsyncMock()

    notif = MagicMock()
    notif.id = "notif-2"
    notif.user_id = "user-1"
    notif.type = NotificationType.ANNOUNCEMENT
    notif.metadata_ = {}
    notif.is_read = False

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = notif
    mock_db.execute = AsyncMock(return_value=mock_result)

    await notifications_service.delete_notification(mock_db, "notif-2", "user-1")

    mock_db.delete.assert_called_once_with(notif)
    mock_db.commit.assert_called_once()


@pytest.mark.asyncio
async def test_get_unread_count_syncs_then_counts() -> None:
    """get_unread_count runs daily reminder sync (side effect) then counts unread."""
    from app.services import notifications_service

    mock_db = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one.return_value = 3
    mock_db.execute = AsyncMock(return_value=mock_result)

    with patch.object(
        notifications_service,
        "_sync_daily_schedule_reminders",
        new_callable=AsyncMock,
    ) as mock_sync:
        result = await notifications_service.get_unread_count(mock_db, "user-1")

    mock_sync.assert_called_once_with(mock_db, "user-1")
    assert result == {"count": 3}


# ── Gap-fill tests ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_delete_attendance_alert_soft_deletes() -> None:
    """ATTENDANCE_ALERT should be soft-deleted (added to _REMINDER_TYPES)."""
    from app.services import notifications_service

    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()

    notif = MagicMock()
    notif.id = "notif-3"
    notif.user_id = "user-1"
    notif.type = NotificationType.ATTENDANCE_ALERT
    notif.metadata_ = {}
    notif.is_read = False

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = notif
    mock_db.execute = AsyncMock(return_value=mock_result)

    await notifications_service.delete_notification(mock_db, "notif-3", "user-1")

    assert notif.metadata_.get("deletedByUser") is True
    mock_db.delete.assert_not_called()


@pytest.mark.asyncio
async def test_submit_class_response_missed_resolves_without_attendance() -> None:
    """
    action='missed': notification is marked resolved+missedClass but NO
    AttendanceRecord is created and no tutor notification is sent.
    """
    from app.services import notifications_service

    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()

    notif = MagicMock()
    notif.id = "notif-5"
    notif.user_id = "user-student"
    notif.metadata_ = {
        "attendancePrompt": True,
        "slotId": "slot-99",
        "reminderDate": "2025-01-15",
        "isPostClass": True,
    }
    notif.is_read = False

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = notif
    mock_db.execute = AsyncMock(return_value=mock_result)

    result = await notifications_service.submit_class_response(
        mock_db,
        "user-student",
        {"notificationId": "notif-5", "action": "missed"},
    )

    assert result == {"message": "Marked as missed class — reminder resolved"}
    assert notif.metadata_["resolved"] is True
    assert notif.metadata_["missedClass"] is True
    assert notif.is_read is True
    # No attendance record should be created
    mock_db.add.assert_not_called()


@pytest.mark.asyncio
async def test_submit_class_response_attended_requires_topic() -> None:
    """
    action='attended' with blank topicCovered should raise a validation error
    at the schema layer (enforced by model_validator).
    """
    from pydantic import ValidationError as PydanticValidationError
    from app.schemas.notifications import ClassResponseRequest

    with pytest.raises(PydanticValidationError):
        ClassResponseRequest(
            notificationId="notif-x",
            action="attended",
            topicCovered="",
        )


@pytest.mark.asyncio
async def test_morning_reminder_has_no_attendance_prompt() -> None:
    """
    _create_student_reminders must NOT set attendancePrompt in metadata.
    The post-class prompt is handled by check_post_class_attendance, not morning reminders.
    """
    from app.workers.notification_worker import _create_student_reminders
    from app.models.enums import DayOfWeek

    mock_db = AsyncMock()

    slot = MagicMock()
    slot.id = "slot-1"
    slot.type.value = "CLASS"
    slot.start_time = "09:00"
    slot.end_time = "10:30"
    slot.room = "101"
    slot.day_of_week = DayOfWeek.MON

    course = MagicMock()
    course.id = "course-1"
    course.course_code = "CSE101"
    course.course_name = "Intro to CS"

    mock_result = MagicMock()
    mock_result.all.return_value = [(slot, course)]
    mock_db.execute = AsyncMock(return_value=mock_result)

    created_metadata: dict = {}

    async def capture_create(db, user_id, type, title, body, metadata=None):
        nonlocal created_metadata
        created_metadata = metadata or {}

    with patch("app.workers.notification_worker.notification_service.create_notification", side_effect=capture_create):
        user = MagicMock()
        user.id = "user-1"
        await _create_student_reminders(mock_db, user, DayOfWeek.MON, "2025-01-06")

    assert "attendancePrompt" not in created_metadata, (
        "Morning reminder must NOT carry attendancePrompt — it belongs only on post-class prompts"
    )


@pytest.mark.asyncio
async def test_11pm_followup_skips_already_resolved() -> None:
    """
    schedule_11pm_followups must skip reminders that already have resolved=True
    in their metadata (student already responded).
    """
    from app.workers.notification_worker import schedule_11pm_followups
    from app.models.enums import NotificationType

    user = MagicMock()
    user.id = "user-1"
    user.notif_newest_update = True
    user.timezone = "UTC"

    already_resolved_notif = MagicMock()
    already_resolved_notif.type = NotificationType.CLASS_REMINDER
    already_resolved_notif.created_at = datetime.now(timezone.utc)
    already_resolved_notif.metadata_ = {
        "attendancePrompt": True,
        "courseId": "c-1",
        "courseCode": "CSE101",
        "slotId": "slot-1",
        "resolved": True,
    }

    mock_db = AsyncMock()
    mock_db.commit = AsyncMock()

    # First call returns users, second returns the resolved reminder
    call_count = 0

    async def fake_execute(_query):
        nonlocal call_count
        call_count += 1
        result = MagicMock()
        if call_count == 1:
            result.scalars.return_value.all.return_value = [user]
        else:
            result.scalars.return_value.all.return_value = [already_resolved_notif]
        return result

    mock_db.execute = fake_execute

    created_notifications: list = []

    async def fake_create(**kwargs):
        created_notifications.append(kwargs)

    with (
        patch("app.workers.notification_worker.AsyncSessionLocal") as mock_session_cls,
        patch("app.workers.notification_worker.notification_service.create_notification", side_effect=fake_create),
        patch("app.workers.notification_worker.datetime") as mock_dt,
    ):
        # Simulate 23:05 UTC for user with UTC timezone
        mock_dt.now.return_value = datetime(2025, 1, 15, 23, 5, 0, tzinfo=timezone.utc)
        mock_dt.combine = datetime.combine
        mock_session_cls.return_value.__aenter__.return_value = mock_db
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        await schedule_11pm_followups({})

    assert len(created_notifications) == 0, (
        "No follow-up should be created for an already-resolved reminder"
    )
