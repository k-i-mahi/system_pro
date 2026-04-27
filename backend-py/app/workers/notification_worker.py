"""ARQ background worker for schedule reminders and 11 PM follow-ups.

Design principles:
- Every job is idempotent via `notificationKey` dedup in `create_notification`.
- Crashes / re-runs never create duplicates.
- Respects user notification prefs (`notif_newest_update` flag).
- All time comparisons use the user's own timezone, never raw server UTC.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone

from arq import cron
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timezones import user_timezone
from app.db.session import AsyncSessionLocal
from app.models.community import Community, CommunityMember
from app.models.course import AttendanceRecord, Enrollment, ScheduleSlot, Course
from app.models.enums import CommunityRole, DayOfWeek, NotificationType, Role
from app.models.misc import Notification
from app.models.user import User
from app.services import notification_service

logger = logging.getLogger(__name__)

_PY_WEEKDAY_TO_ENUM: dict[int, DayOfWeek] = {
    0: DayOfWeek.MON,
    1: DayOfWeek.TUE,
    2: DayOfWeek.WED,
    3: DayOfWeek.THU,
    4: DayOfWeek.FRI,
    5: DayOfWeek.SAT,
    6: DayOfWeek.SUN,
}


async def scan_schedule_reminders(ctx: dict) -> None:
    """
    Run every 60 s.  For every user with schedule slots today, create
    informational class / lab reminders (morning overview — no response form).
    Idempotency via notificationKey.
    """
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        users = (await db.execute(select(User))).scalars().all()

        for user in users:
            if not user.notif_newest_update:
                continue

            tz = user_timezone(user)
            local_now = now.astimezone(tz)
            local_today = local_now.date()
            day_enum = _PY_WEEKDAY_TO_ENUM[local_today.weekday()]
            today_iso = local_today.isoformat()

            try:
                await _create_student_reminders(db, user, day_enum, today_iso)
                await _create_tutor_reminders(db, user, day_enum, today_iso, now, local_today)
                await db.commit()
            except Exception as exc:
                logger.error("Reminder scan failed for user %s: %s", user.id, exc)
                await db.rollback()


async def _create_student_reminders(
    db: AsyncSession,
    user: User,
    day_enum: DayOfWeek,
    today_iso: str,
) -> None:
    """
    Informational morning overview — shows what classes the student has today.
    No attendancePrompt here; response form lives on the post-class notification only.
    """
    if user.role != Role.STUDENT:
        return

    slots = (
        await db.execute(
            select(ScheduleSlot, Course)
            .join(Course, Course.id == ScheduleSlot.course_id)
            .join(Enrollment, Enrollment.course_id == ScheduleSlot.course_id)
            .where(Enrollment.user_id == user.id, ScheduleSlot.day_of_week == day_enum)
        )
    ).all()

    for slot, course in slots:
        notif_type = (
            NotificationType.LAB_REMINDER if slot.type.value == "LAB" else NotificationType.CLASS_REMINDER
        )
        notif_key = f"student:{today_iso}:{slot.id}"
        await notification_service.create_notification(
            db=db,
            user_id=user.id,
            type=notif_type,
            title=f"Today's {slot.type.value.title()}: {course.course_code} at {slot.start_time}",
            body=(
                f"You have {course.course_code} today from {slot.start_time} to {slot.end_time}. "
                "After class, you'll be prompted to log what was covered."
            ),
            metadata={
                "notificationKey": notif_key,
                "slotId": slot.id,
                "courseId": course.id,
                "courseCode": course.course_code,
                "courseName": course.course_name,
                "startTime": slot.start_time,
                "endTime": slot.end_time,
                "room": slot.room,
                "reminderDate": today_iso,
                "reminderRole": "student",
                "deepLink": f"/courses/{course.id}",
            },
        )


async def _create_tutor_reminders(
    db: AsyncSession,
    user: User,
    day_enum: DayOfWeek,
    today_iso: str,
    now: datetime,
    local_today: date,
) -> None:
    if user.role == Role.STUDENT:
        return

    tutor_slots = (
        await db.execute(
            select(ScheduleSlot, Course, Community)
            .join(Course, Course.id == ScheduleSlot.course_id)
            .join(Community, Community.course_id == Course.id)
            .join(CommunityMember, CommunityMember.community_id == Community.id)
            .where(
                CommunityMember.user_id == user.id,
                CommunityMember.role == CommunityRole.TUTOR,
                ScheduleSlot.day_of_week == day_enum,
            )
        )
    ).all()

    tz = user_timezone(user)
    seen: set[str] = set()
    for slot, course, community in tutor_slots:
        if slot.id in seen:
            continue
        seen.add(slot.id)
        notif_key = f"tutor:{today_iso}:{slot.id}"
        try:
            start_h, start_m = [int(v) for v in slot.start_time.split(":")]
            local_start = datetime.combine(local_today, time(start_h, start_m), tzinfo=tz)
            minutes_to_start = int((local_start.astimezone(timezone.utc) - now).total_seconds() // 60)
        except (ValueError, AttributeError):
            minutes_to_start = 9999

        if -15 <= minutes_to_start <= 45:
            title = f"Class starts soon: {course.course_code} at {slot.start_time}"
        else:
            title = f"Today's teaching slot: {course.course_code} at {slot.start_time}"

        await notification_service.create_notification(
            db=db,
            user_id=user.id,
            type=NotificationType.CLASS_REMINDER,
            title=title,
            body=f"Reminder: teach {course.course_code} ({community.name}) from {slot.start_time} to {slot.end_time}.",
            metadata={
                "notificationKey": notif_key,
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


async def check_post_class_attendance(ctx: dict) -> None:
    """
    Runs every minute.  For each ScheduleSlot whose end_time just elapsed
    (0–2 min) in the enrolled student's OWN timezone, fire a post-class
    CLASS_REMINDER with attendancePrompt:true so the student can respond inline.

    Uses per-user timezone so students in UTC+6 get the prompt at their local
    class-end time, not at UTC class-end time.

    Idempotency key: post-class:{local_date_iso}:{slot_id}:{user_id}
    """
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        try:
            # All slots scheduled for any day (we'll filter per-user by their local weekday)
            all_slots = (await db.execute(
                select(ScheduleSlot, Course)
                .join(Course, Course.id == ScheduleSlot.course_id)
            )).all()

            for slot, course in all_slots:
                # Enrolled students for this course
                enrollments = (await db.execute(
                    select(Enrollment).join(User, User.id == Enrollment.user_id)
                    .where(
                        Enrollment.course_id == slot.course_id,
                        User.role == "STUDENT",
                    )
                )).scalars().all()

                for enr in enrollments:
                    uid = enr.user_id
                    user = await db.get(User, uid)
                    if not user or not user.notif_newest_update:
                        continue

                    tz = user_timezone(user)
                    local_now = now.astimezone(tz)
                    local_today = local_now.date()

                    # Only process if the slot is scheduled for today in the user's timezone
                    user_day_enum = _PY_WEEKDAY_TO_ENUM[local_today.weekday()]
                    if slot.day_of_week != user_day_enum:
                        continue

                    # Check if the slot just ended (0–2 min window) in user's local time
                    try:
                        end_h, end_m = (int(v) for v in slot.end_time.split(":"))
                        local_end = datetime.combine(local_today, time(end_h, end_m), tzinfo=tz)
                        minutes_since_end = (now - local_end.astimezone(timezone.utc)).total_seconds() / 60
                        if not (0 <= minutes_since_end < 2):
                            continue
                    except (ValueError, AttributeError):
                        continue

                    today_iso = local_today.isoformat()
                    attendance_dt = datetime.combine(local_today, time.min, tzinfo=timezone.utc)

                    # Skip if attendance already recorded for this slot today
                    already_marked = (await db.execute(
                        select(AttendanceRecord).where(
                            AttendanceRecord.user_id == uid,
                            AttendanceRecord.slot_id == slot.id,
                            AttendanceRecord.date == attendance_dt,
                        )
                    )).scalar_one_or_none()
                    if already_marked:
                        continue

                    notif_type = (
                        NotificationType.LAB_REMINDER if slot.type.value == "LAB"
                        else NotificationType.CLASS_REMINDER
                    )
                    notif_key = f"post-class:{today_iso}:{slot.id}:{uid}"
                    await notification_service.create_notification(
                        db=db,
                        user_id=uid,
                        type=notif_type,
                        title=f"Class ended: {course.course_code}",
                        body=(
                            "Upload today's material or tell me what topic was covered "
                            "so I can help you organize it."
                        ),
                        metadata={
                            "notificationKey": notif_key,
                            "slotId": slot.id,
                            "courseId": course.id,
                            "courseCode": course.course_code,
                            "courseName": course.course_name,
                            "startTime": slot.start_time,
                            "endTime": slot.end_time,
                            "reminderDate": today_iso,
                            "attendancePrompt": True,
                            "requiresResponse": True,
                            "isPostClass": True,
                            "deepLink": f"/courses/{course.id}",
                        },
                    )

            await db.commit()
        except Exception as exc:
            logger.error("Post-class attendance check failed: %s", exc)
            await db.rollback()


async def schedule_11pm_followups(ctx: dict) -> None:
    """
    Runs every hour.  For each user whose local time is currently 23:xx
    (i.e. it is 11 PM in their timezone), send a follow-up for any class
    reminders from today that have not been responded to or resolved.

    Running hourly rather than at a fixed UTC hour ensures every timezone
    gets the follow-up at their local 11 PM, not at 23:00 UTC.
    """
    now = datetime.now(timezone.utc)

    async with AsyncSessionLocal() as db:
        try:
            users = (await db.execute(select(User))).scalars().all()

            for user in users:
                if not user.notif_newest_update:
                    continue
                if user.role != Role.STUDENT:
                    continue

                tz = user_timezone(user)
                local_now = now.astimezone(tz)

                # Only fire for users currently at 11 PM in their local timezone
                if local_now.hour != 23:
                    continue

                local_today = local_now.date()
                today_iso = local_today.isoformat()
                start_of_local_day = datetime.combine(local_today, time.min, tzinfo=tz)
                start_of_day_utc = start_of_local_day.astimezone(timezone.utc)

                # Find today's attendance-prompt reminders for this user that are unresolved
                reminders = (
                    await db.execute(
                        select(Notification).where(
                            Notification.user_id == user.id,
                            Notification.type.in_([
                                NotificationType.CLASS_REMINDER,
                                NotificationType.LAB_REMINDER,
                            ]),
                            Notification.created_at >= start_of_day_utc,
                        )
                    )
                ).scalars().all()

                for reminder in reminders:
                    meta = reminder.metadata_ or {}
                    # Only process post-class prompts (have attendancePrompt) not tutor reminders
                    if not meta.get("attendancePrompt"):
                        continue
                    # Skip already resolved / responded / dismissed
                    if meta.get("classResponse"):
                        continue
                    if meta.get("resolved"):
                        continue
                    if meta.get("deletedByUser"):
                        continue

                    slot_id = meta.get("slotId", reminder.id)
                    followup_key = f"class_followup:{user.id}:{meta.get('courseId', '')}:{slot_id}:{today_iso}"
                    await notification_service.create_notification(
                        db=db,
                        user_id=user.id,
                        type=NotificationType.CLASS_REMINDER,
                        title="Still no material for today's class",
                        body=(
                            f"Did you miss today's {meta.get('courseCode', 'class')}? "
                            "If you upload the materials or tell me what topic was covered today, "
                            "I can assist you to catch up."
                        ),
                        metadata={
                            "notificationKey": followup_key,
                            "slotId": slot_id,
                            "courseId": meta.get("courseId"),
                            "courseCode": meta.get("courseCode"),
                            "reminderDate": today_iso,
                            "attendancePrompt": True,
                            "requiresResponse": True,
                            "isFollowup": True,
                            "deepLink": "/notifications",
                        },
                    )

            await db.commit()
        except Exception as exc:
            logger.error("11pm follow-up job failed: %s", exc)
            await db.rollback()


_ALL_MINUTES = set(range(60))

class WorkerSettings:
    functions = [scan_schedule_reminders, check_post_class_attendance, schedule_11pm_followups]
    cron_jobs = [
        cron(scan_schedule_reminders, minute=_ALL_MINUTES),
        cron(check_post_class_attendance, minute=_ALL_MINUTES),
        # Runs every hour; internally filters to users whose local time is 23:xx
        cron(schedule_11pm_followups, minute=0),
    ]
    queue_name = "notifications"
