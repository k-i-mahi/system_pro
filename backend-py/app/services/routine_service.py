from __future__ import annotations

import logging

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.community import Community, CommunityMember
from app.models.course import Course, Enrollment, ScheduleSlot
from app.models.enums import CommunityRole, DayOfWeek, SlotType
from app.models.misc import RoutineScan
from app.schemas.routine import BulkCreateCoursesRequest, MoveSlotRequest, UpdateSlotRequest
from app.services import cloudinary_service
from app.services.ocr_service import extract_text_from_file

logger = logging.getLogger(__name__)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _slot_to_dict(s: ScheduleSlot, **extra) -> dict:
    d = {
        "id": s.id,
        "courseId": s.course_id,
        "dayOfWeek": s.day_of_week,
        "startTime": s.start_time,
        "endTime": s.end_time,
        "type": s.type,
        "room": s.room,
    }
    d.update(extra)
    return d


def _time_overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    return a_start < b_end and a_end > b_start


def _add_minutes(t: str, minutes: int) -> str:
    h, m = map(int, t.split(":"))
    total = h * 60 + m + minutes
    return f"{(total // 60) % 24:02d}:{total % 60:02d}"


def _duration_minutes(start: str, end: str) -> int:
    sh, sm = map(int, start.split(":"))
    eh, em = map(int, end.split(":"))
    return (eh * 60 + em) - (sh * 60 + sm)


async def _user_course_ids(db: AsyncSession, user_id: str) -> list[str]:
    enr = await db.execute(select(Enrollment.course_id).where(Enrollment.user_id == user_id))
    ids = set(enr.scalars().all())
    tutor = await db.execute(
        select(Community.course_id)
        .join(CommunityMember, CommunityMember.community_id == Community.id)
        .where(CommunityMember.user_id == user_id, CommunityMember.role == CommunityRole.TUTOR)
    )
    ids.update(tutor.scalars().all())
    return list(ids)


# ── Public API ────────────────────────────────────────────────────────────────

async def scan_routine(
    db: AsyncSession,
    user_id: str,
    file_bytes: bytes,
    filename: str,
) -> dict:
    # Upload to Cloudinary (best-effort — OCR continues even if upload fails)
    file_url = ""
    try:
        upload = await cloudinary_service.upload_file(file_bytes, "routine-scans")
        file_url = upload["secure_url"]
    except Exception as exc:
        logger.warning("Cloudinary upload failed (continuing with OCR): %s", exc)

    # Fast OCR first
    extraction = await extract_text_from_file(file_bytes, filename, "fast")

    # Retry with accurate mode if no codes detected
    if not extraction["codes"]:
        try:
            accurate = await extract_text_from_file(file_bytes, filename, "accurate")
            if len(accurate["codes"]) > len(extraction["codes"]) or len(accurate["text"]) > len(extraction["text"]):
                extraction = accurate
        except Exception as exc:
            logger.warning("accurate OCR retry failed: %s", exc)

    scan = RoutineScan(
        user_id=user_id,
        file_url=file_url,
        extracted_text=extraction["text"],
        parsed_codes=extraction["codes"],
        status="DONE",  # type: ignore[arg-type]
    )
    db.add(scan)
    await db.commit()
    await db.refresh(scan)

    return {"scanId": scan.id, "extractedCodes": extraction["codes"], "rawText": extraction["text"]}


async def get_schedule(db: AsyncSession, user_id: str) -> list[dict]:
    slot_map: dict[str, dict] = {}

    # Enrolled courses → schedule slots
    enrolled = await db.execute(
        select(Enrollment.course_id).where(Enrollment.user_id == user_id)
    )
    course_ids = list(enrolled.scalars().all())

    if course_ids:
        slots_result = await db.execute(
            select(ScheduleSlot, Course)
            .join(Course, ScheduleSlot.course_id == Course.id)
            .where(ScheduleSlot.course_id.in_(course_ids))
        )
        for slot, course in slots_result.all():
            slot_map[slot.id] = _slot_to_dict(
                slot,
                courseCode=course.course_code,
                courseName=course.course_name,
                courseId=course.id,
            )

    # Tutor community courses → schedule slots (deduplicated)
    tutor_result = await db.execute(
        select(Community.course_id)
        .join(CommunityMember, CommunityMember.community_id == Community.id)
        .where(CommunityMember.user_id == user_id, CommunityMember.role == CommunityRole.TUTOR)
    )
    tutor_course_ids = [cid for cid in tutor_result.scalars().all() if cid not in course_ids]

    if tutor_course_ids:
        tutor_slots = await db.execute(
            select(ScheduleSlot, Course)
            .join(Course, ScheduleSlot.course_id == Course.id)
            .where(ScheduleSlot.course_id.in_(tutor_course_ids))
        )
        for slot, course in tutor_slots.all():
            if slot.id not in slot_map:
                slot_map[slot.id] = _slot_to_dict(
                    slot,
                    courseCode=course.course_code,
                    courseName=course.course_name,
                    courseId=course.id,
                )

    return list(slot_map.values())


async def bulk_create_courses(db: AsyncSession, user_id: str, body: BulkCreateCoursesRequest) -> list[dict]:
    results = []
    for course_data in body.courses:
        # Find or create course
        result = await db.execute(
            select(Course).where(Course.course_code == course_data.courseCode)
        )
        course = result.scalar_one_or_none()
        if not course:
            course = Course(
                course_code=course_data.courseCode,
                course_name=course_data.courseName,
            )
            db.add(course)
            await db.flush()  # get id without committing

        # Upsert enrollment
        enr_result = await db.execute(
            select(Enrollment).where(
                Enrollment.user_id == user_id,
                Enrollment.course_id == course.id,
            )
        )
        if not enr_result.scalar_one_or_none():
            db.add(Enrollment(user_id=user_id, course_id=course.id))

        # Create schedule slots
        for slot in course_data.slots:
            db.add(ScheduleSlot(
                course_id=course.id,
                day_of_week=slot.dayOfWeek,
                start_time=slot.startTime,
                end_time=slot.endTime,
                type=slot.type,
                room=slot.room,
            ))

        results.append({
            "id": course.id,
            "courseCode": course.course_code,
            "courseName": course.course_name,
        })

    await db.commit()
    return results


async def update_slot(db: AsyncSession, slot_id: str, body: UpdateSlotRequest) -> dict:
    result = await db.execute(select(ScheduleSlot).where(ScheduleSlot.id == slot_id))
    slot = result.scalar_one_or_none()
    if not slot:
        raise NotFoundError("Slot not found")

    updates = body.model_dump(exclude_none=True)
    if "dayOfWeek" in updates:
        slot.day_of_week = updates["dayOfWeek"]
    if "startTime" in updates:
        slot.start_time = updates["startTime"]
    if "endTime" in updates:
        slot.end_time = updates["endTime"]
    if "type" in updates:
        slot.type = updates["type"]
    if "room" in updates:
        slot.room = updates["room"]

    await db.commit()
    await db.refresh(slot)
    return _slot_to_dict(slot)


async def delete_slot(db: AsyncSession, slot_id: str) -> None:
    result = await db.execute(select(ScheduleSlot).where(ScheduleSlot.id == slot_id))
    if not result.scalar_one_or_none():
        raise NotFoundError("Slot not found")
    await db.execute(delete(ScheduleSlot).where(ScheduleSlot.id == slot_id))
    await db.commit()


async def move_slot(db: AsyncSession, slot_id: str, user_id: str, body: MoveSlotRequest) -> dict:
    result = await db.execute(select(ScheduleSlot).where(ScheduleSlot.id == slot_id))
    slot = result.scalar_one_or_none()
    if not slot:
        raise NotFoundError("Slot not found")

    enrolled_course_ids = await _user_course_ids(db, user_id)

    # All slots on target day (excluding the one being moved)
    day_result = await db.execute(
        select(ScheduleSlot).where(
            ScheduleSlot.course_id.in_(enrolled_course_ids),
            ScheduleSlot.day_of_week == body.dayOfWeek,
            ScheduleSlot.id != slot_id,
        )
    )
    slots_on_day = day_result.scalars().all()
    conflicts = [
        s for s in slots_on_day
        if _time_overlaps(slot.start_time, slot.end_time, s.start_time, s.end_time)
    ]

    # No conflicts — just move
    if not conflicts:
        slot.day_of_week = body.dayOfWeek
        await db.commit()
        await db.refresh(slot)
        return {"slot": _slot_to_dict(slot), "conflicts": [], "resolved": True}

    # Conflicts but no resolution strategy — return for UI to decide
    if not body.resolveConflicts:
        return {
            "slot": _slot_to_dict(slot),
            "targetDay": body.dayOfWeek,
            "conflicts": [
                {"id": c.id, "courseId": c.course_id, "startTime": c.start_time,
                 "endTime": c.end_time, "type": c.type, "room": c.room}
                for c in conflicts
            ],
            "resolved": False,
        }

    if body.resolveConflicts == "override":
        slot.day_of_week = body.dayOfWeek
        await db.commit()
        await db.refresh(slot)
        return {
            "slot": _slot_to_dict(slot),
            "conflicts": [{"id": c.id, "startTime": c.start_time, "endTime": c.end_time} for c in conflicts],
            "resolved": True,
            "warning": "Time conflicts exist",
        }

    if body.resolveConflicts == "swap" and len(conflicts) == 1:
        conflicting = conflicts[0]
        original_day = slot.day_of_week
        slot.day_of_week = body.dayOfWeek
        conflicting.day_of_week = original_day
        await db.commit()
        await db.refresh(slot)
        return {"slot": _slot_to_dict(slot), "conflicts": [], "resolved": True}

    if body.resolveConflicts == "shift":
        slot.day_of_week = body.dayOfWeek
        await db.flush()

        for conflict in conflicts:
            duration = _duration_minutes(conflict.start_time, conflict.end_time)
            all_on_day_result = await db.execute(
                select(ScheduleSlot).where(
                    ScheduleSlot.course_id.in_(enrolled_course_ids),
                    ScheduleSlot.day_of_week == body.dayOfWeek,
                    ScheduleSlot.id != conflict.id,
                ).order_by(ScheduleSlot.start_time)
            )
            all_on_day = all_on_day_result.scalars().all()

            new_start = conflict.end_time
            for _ in range(20):
                new_end = _add_minutes(new_start, duration)
                has_overlap = any(
                    _time_overlaps(new_start, new_end, s.start_time, s.end_time)
                    for s in all_on_day
                )
                if not has_overlap and new_end <= "23:59":
                    conflict.start_time = new_start
                    conflict.end_time = new_end
                    break
                new_start = _add_minutes(new_start, 30)

        await db.commit()
        await db.refresh(slot)
        return {"slot": _slot_to_dict(slot), "conflicts": [], "resolved": True}

    # Fallback: override
    slot.day_of_week = body.dayOfWeek
    await db.commit()
    await db.refresh(slot)
    return {
        "slot": _slot_to_dict(slot),
        "conflicts": [{"id": c.id} for c in conflicts],
        "resolved": True,
    }


async def delete_course(db: AsyncSession, user_id: str, course_id: str) -> None:
    await db.execute(
        delete(Enrollment).where(
            Enrollment.user_id == user_id,
            Enrollment.course_id == course_id,
        )
    )
    await db.commit()
