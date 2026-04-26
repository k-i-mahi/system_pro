from __future__ import annotations

import logging
from datetime import date, datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError, ValidationError
from app.models.community import Community, CommunityMember
from app.models.course import AttendanceRecord, Course, Enrollment, ScheduleSlot
from app.models.enums import CommunityRole, DayOfWeek, NotificationType
from app.models.misc import Notification
from app.models.user import User
from app.services import notification_service

logger = logging.getLogger(__name__)


def _serialize(n: Notification) -> dict:
    return {
        "id": n.id,
        "userId": n.user_id,
        "type": n.type,
        "title": n.title,
        "body": n.body,
        "isRead": n.is_read,
        "createdAt": n.created_at,
        "metadata": n.metadata_,
    }


_PY_WEEKDAY_TO_ENUM: dict[int, DayOfWeek] = {
    0: DayOfWeek.MON,
    1: DayOfWeek.TUE,
    2: DayOfWeek.WED,
    3: DayOfWeek.THU,
    4: DayOfWeek.FRI,
    5: DayOfWeek.SAT,
    6: DayOfWeek.SUN,
}


def _today_context() -> tuple[date, datetime, DayOfWeek]:
    now = datetime.now(timezone.utc)
    today = now.date()
    return today, now, _PY_WEEKDAY_TO_ENUM[now.weekday()]


async def _existing_daily_reminder_keys(db: AsyncSession, user_id: str, start_of_day: datetime) -> set[str]:
    rows = (
        await db.execute(
            select(Notification).where(
                Notification.user_id == user_id,
                Notification.type.in_([NotificationType.CLASS_REMINDER, NotificationType.LAB_REMINDER]),
                Notification.created_at >= start_of_day,
            )
        )
    ).scalars().all()
    keys: set[str] = set()
    for n in rows:
        meta = n.metadata_ or {}
        slot_id = meta.get("slotId")
        role = meta.get("reminderRole")
        reminder_date = meta.get("reminderDate")
        if slot_id and role and reminder_date:
            keys.add(f"{role}:{reminder_date}:{slot_id}")
    return keys


async def _ensure_daily_schedule_reminders(db: AsyncSession, user_id: str) -> None:
    today, now, day_enum = _today_context()
    start_of_day = datetime.combine(today, time.min, tzinfo=timezone.utc)
    existing = await _existing_daily_reminder_keys(db, user_id, start_of_day)
    today_iso = today.isoformat()

    student_slots = (
        await db.execute(
            select(ScheduleSlot, Course)
            .join(Course, Course.id == ScheduleSlot.course_id)
            .join(Enrollment, Enrollment.course_id == ScheduleSlot.course_id)
            .where(Enrollment.user_id == user_id, ScheduleSlot.day_of_week == day_enum)
        )
    ).all()

    for slot, course in student_slots:
        reminder_key = f"student:{today_iso}:{slot.id}"
        if reminder_key in existing:
            continue
        notif_type = NotificationType.LAB_REMINDER if slot.type.value == "LAB" else NotificationType.CLASS_REMINDER
        await notification_service.create_notification(
            db=db,
            user_id=user_id,
            type=notif_type,
            title=f"Today's {slot.type.value.title()}: {course.course_code} at {slot.start_time}",
            body=(
                f"Attend {course.course_code} today and submit what topic was covered. "
                "If materials are needed, request them in your response."
            ),
            metadata={
                "slotId": slot.id,
                "courseId": course.id,
                "courseCode": course.course_code,
                "courseName": course.course_name,
                "startTime": slot.start_time,
                "endTime": slot.end_time,
                "room": slot.room,
                "reminderDate": today_iso,
                "reminderRole": "student",
                "attendancePrompt": True,
                "requiresResponse": True,
                "deepLink": "/notifications",
            },
        )

    tutor_slots = (
        await db.execute(
            select(ScheduleSlot, Course, Community)
            .join(Course, Course.id == ScheduleSlot.course_id)
            .join(Community, Community.course_id == Course.id)
            .join(CommunityMember, CommunityMember.community_id == Community.id)
            .where(
                CommunityMember.user_id == user_id,
                CommunityMember.role == CommunityRole.TUTOR,
                ScheduleSlot.day_of_week == day_enum,
            )
        )
    ).all()

    seen_tutor_slot_ids: set[str] = set()
    for slot, course, community in tutor_slots:
        if slot.id in seen_tutor_slot_ids:
            continue
        seen_tutor_slot_ids.add(slot.id)
        reminder_key = f"tutor:{today_iso}:{slot.id}"
        if reminder_key in existing:
            continue
        start_h, start_m = [int(v) for v in slot.start_time.split(":")]
        start_dt = datetime.combine(today, time(start_h, start_m), tzinfo=timezone.utc)
        minutes_to_start = int((start_dt - now).total_seconds() // 60)
        if -15 <= minutes_to_start <= 45:
            title = f"Class starts soon: {course.course_code} at {slot.start_time}"
        else:
            title = f"Today's teaching slot: {course.course_code} at {slot.start_time}"

        await notification_service.create_notification(
            db=db,
            user_id=user_id,
            type=NotificationType.CLASS_REMINDER,
            title=title,
            body=f"Reminder: take {course.course_code} ({community.name}) from {slot.start_time} to {slot.end_time}.",
            metadata={
                "slotId": slot.id,
                "courseId": course.id,
                "communityId": community.id,
                "courseCode": course.course_code,
                "courseName": course.course_name,
                "startTime": slot.start_time,
                "endTime": slot.end_time,
                "room": slot.room,
                "reminderDate": today_iso,
                "reminderRole": "tutor",
                "deepLink": f"/community/{community.id}",
            },
        )


def _is_soft_deleted(n: Notification) -> bool:
    """Return True if this notification was soft-deleted by the user."""
    meta = n.metadata_ or {}
    return bool(meta.get("deletedByUser"))


async def _sync_daily_schedule_reminders(db: AsyncSession, user_id: str) -> None:
    """Create today's class/lab rows if missing. Safe to call on list and unread-count."""
    try:
        await _ensure_daily_schedule_reminders(db, user_id)
        await db.commit()
    except Exception:
        logger.exception("sync daily schedule reminders failed for user %s", user_id)
        await db.rollback()


async def list_notifications(db: AsyncSession, user_id: str, page: int, limit: int) -> tuple[list[dict], int]:
    await _sync_daily_schedule_reminders(db, user_id)

    offset = (page - 1) * limit
    rows = (await db.execute(
        select(Notification)
        .where(Notification.user_id == user_id)
        .order_by(Notification.created_at.desc())
        .offset(offset)
        .limit(limit + 200)  # over-fetch to account for soft-deleted
    )).scalars().all()
    visible = [n for n in rows if not _is_soft_deleted(n)]
    total = (await db.execute(
        select(func.count()).select_from(Notification).where(Notification.user_id == user_id)
    )).scalar_one()
    return [_serialize(n) for n in visible[:limit]], total


async def mark_read(db: AsyncSession, notif_id: str, user_id: str) -> dict:
    n = (await db.execute(
        select(Notification).where(Notification.id == notif_id, Notification.user_id == user_id)
    )).scalar_one_or_none()
    if not n:
        raise NotFoundError("Notification not found")
    n.is_read = True
    await db.commit()
    return {"message": "Marked as read"}


async def mark_all_read(db: AsyncSession, user_id: str) -> dict:
    rows = (await db.execute(
        select(Notification).where(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
    )).scalars().all()
    for n in rows:
        n.is_read = True
    await db.commit()
    return {"message": "All marked as read"}


_REMINDER_TYPES = {NotificationType.CLASS_REMINDER, NotificationType.LAB_REMINDER, NotificationType.ATTENDANCE_ALERT}


async def delete_notification(db: AsyncSession, notif_id: str, user_id: str) -> dict:
    n = (await db.execute(
        select(Notification).where(Notification.id == notif_id, Notification.user_id == user_id)
    )).scalar_one_or_none()
    if not n:
        raise NotFoundError("Notification not found")
    if n.type in _REMINDER_TYPES:
        # Soft-delete reminders so idempotent worker keys still resolve but they
        # disappear from the user's notification list.
        n.metadata_ = {**(n.metadata_ or {}), "deletedByUser": True}
        n.is_read = True
        await db.commit()
    else:
        await db.delete(n)
        await db.commit()
    return {"message": "Notification deleted"}


async def get_unread_count(db: AsyncSession, user_id: str) -> dict:
    # Same materialization as list, so the bell refetches created rows and users see alerts without
    # opening the full notifications page first.
    await _sync_daily_schedule_reminders(db, user_id)

    count = (await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.user_id == user_id, Notification.is_read == False  # noqa: E712
        )
    )).scalar_one()
    return {"count": count}


async def submit_class_response(db: AsyncSession, user_id: str, payload: dict) -> dict:
    notif = (
        await db.execute(
            select(Notification).where(
                Notification.id == payload["notificationId"],
                Notification.user_id == user_id,
            )
        )
    ).scalar_one_or_none()
    if not notif:
        raise NotFoundError("Notification not found")

    metadata = notif.metadata_ or {}
    if not metadata.get("attendancePrompt"):
        raise ValidationError("This notification does not accept class responses", code="INVALID_NOTIFICATION_TYPE")

    slot_id = metadata.get("slotId")
    reminder_date = metadata.get("reminderDate")
    if not slot_id or not reminder_date:
        raise ValidationError("Missing slot context in reminder", code="INVALID_NOTIFICATION_METADATA")

    action = payload.get("action", "attended")

    # ── "I missed class" path ────────────────────────────────────────────────
    if action == "missed":
        notif.metadata_ = {
            **metadata,
            "resolved": True,
            "missedClass": True,
            "respondedAt": datetime.now(timezone.utc).isoformat(),
        }
        notif.is_read = True
        await db.commit()
        return {"message": "Marked as missed class — reminder resolved"}

    # ── "I attended" path ────────────────────────────────────────────────────
    attendance_dt = datetime.fromisoformat(f"{reminder_date}T00:00:00+00:00")
    slot = await db.get(ScheduleSlot, slot_id)
    if not slot:
        raise NotFoundError("Schedule slot not found")

    existing = (
        await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.user_id == user_id,
                AttendanceRecord.slot_id == slot_id,
                AttendanceRecord.date == attendance_dt,
            )
        )
    ).scalar_one_or_none()
    if existing:
        existing.present = True
    else:
        db.add(AttendanceRecord(user_id=user_id, slot_id=slot_id, date=attendance_dt, present=True))

    response_payload = {
        "topicCovered": (payload.get("topicCovered") or "").strip(),
        "materialNeeded": bool(payload.get("materialNeeded", False)),
        "materialRequest": (payload.get("materialRequest") or "").strip() or None,
        "notes": (payload.get("notes") or "").strip() or None,
        "respondedAt": datetime.now(timezone.utc).isoformat(),
    }

    notif.metadata_ = {**metadata, "resolved": True, "classResponse": response_payload}
    notif.is_read = True

    student = await db.get(User, user_id)
    course = await db.get(Course, slot.course_id)
    if course:
        tutor_ids = set(
            (
                await db.execute(
                    select(CommunityMember.user_id)
                    .join(Community, Community.id == CommunityMember.community_id)
                    .where(Community.course_id == course.id, CommunityMember.role == CommunityRole.TUTOR)
                )
            )
            .scalars()
            .all()
        )
        creator_ids = set(
            (await db.execute(select(Community.created_by).where(Community.course_id == course.id))).scalars().all()
        )
        tutor_ids.update(creator_ids)
        tutor_ids.discard(user_id)

        for tutor_id in tutor_ids:
            notif_key = f"class_response:{slot_id}:{reminder_date}:{tutor_id}"
            await notification_service.create_notification(
                db=db,
                user_id=tutor_id,
                type=NotificationType.MATERIAL_UPLOAD_PROMPT,
                title=f"Class update from {student.name if student else 'student'}",
                body=(
                    f"{course.course_code}: {response_payload['topicCovered']}. "
                    + (
                        f"Material requested: {response_payload['materialRequest'] or 'Yes'}."
                        if response_payload["materialNeeded"]
                        else "No material request."
                    )
                ),
                metadata={
                    "notificationKey": notif_key,
                    "courseId": course.id,
                    "courseCode": course.course_code,
                    "slotId": slot_id,
                    "fromUserId": user_id,
                    "attendanceDate": reminder_date,
                    "deepLink": "/community",
                    "classResponse": response_payload,
                },
            )

    await db.commit()
    return {"message": "Class response submitted and attendance recorded"}
