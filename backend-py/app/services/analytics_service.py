from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.community import Community, CommunityMember
from app.models.course import AttendanceRecord, Course, Enrollment, ScheduleSlot, Topic, TopicProgress
from app.models.enums import CommunityRole, Role
from app.models.misc import ExamAttempt
from app.models.user import User


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _decayed_expertise(raw: float, last_studied: datetime | None) -> float:
    if last_studied is None:
        return raw
    days_since = (datetime.now(timezone.utc) - _as_utc(last_studied)).total_seconds() / 86400
    return raw * math.pow(0.95, days_since / 7)


# ── Overview ──────────────────────────────────────────────────────────────────

async def get_overview(db: AsyncSession, user_id: str) -> dict:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()

    if user and user.role == Role.TUTOR:
        return await _overview_tutor(db, user_id)
    return await _overview_student(db, user_id)


async def _overview_tutor(db: AsyncSession, user_id: str) -> dict:
    communities = (await db.execute(
        select(Community).where(Community.created_by == user_id)
    )).scalars().all()

    community_ids = [c.id for c in communities]
    course_ids = [c.course_id for c in communities]

    members = (await db.execute(
        select(CommunityMember).where(
            CommunityMember.community_id.in_(community_ids),
            CommunityMember.role == CommunityRole.STUDENT,
        )
    )).scalars().all()
    student_ids = list({m.user_id for m in members})

    if not student_ids or not course_ids:
        return {
            "role": "TUTOR",
            "totalCoursesTeaching": len(communities),
            "totalStudents": 0,
            "avgClassAttendance": 0,
            "avgClassCT": 0,
        }

    attendance = (await db.execute(
        select(AttendanceRecord)
        .join(ScheduleSlot, AttendanceRecord.slot_id == ScheduleSlot.id)
        .where(
            AttendanceRecord.user_id.in_(student_ids),
            ScheduleSlot.course_id.in_(course_ids),
        )
    )).scalars().all()

    enrollments = (await db.execute(
        select(Enrollment).where(
            Enrollment.user_id.in_(student_ids),
            Enrollment.course_id.in_(course_ids),
        )
    )).scalars().all()

    total_present = sum(1 for a in attendance if a.present)
    avg_attendance = round((total_present / len(attendance)) * 100) if attendance else 0

    ct_scores = [s for e in enrollments for s in [e.ct_score1, e.ct_score2, e.ct_score3] if s is not None]
    avg_ct = round(sum(ct_scores) / len(ct_scores)) if ct_scores else 0

    return {
        "role": "TUTOR",
        "totalCoursesTeaching": len(communities),
        "totalStudents": len(student_ids),
        "avgClassAttendance": avg_attendance,
        "avgClassCT": avg_ct,
    }


async def _overview_student(db: AsyncSession, user_id: str) -> dict:
    enrollments = (await db.execute(
        select(Enrollment).where(Enrollment.user_id == user_id)
    )).scalars().all()

    course_ids = [e.course_id for e in enrollments]
    topics_all = (await db.execute(
        select(Topic).where(Topic.course_id.in_(course_ids))
    )).scalars().all() if course_ids else []

    attendance = (await db.execute(
        select(AttendanceRecord).where(AttendanceRecord.user_id == user_id)
    )).scalars().all()

    topic_progress = (await db.execute(
        select(TopicProgress).where(TopicProgress.user_id == user_id)
    )).scalars().all()

    present_count = sum(1 for a in attendance if a.present)
    avg_attendance = round((present_count / len(attendance)) * 100) if attendance else 0

    ct_scores = [s for e in enrollments for s in [e.ct_score1, e.ct_score2, e.ct_score3] if s is not None]
    avg_ct = round(sum(ct_scores) / len(ct_scores)) if ct_scores else 0

    topics_mastered = sum(1 for tp in topic_progress if tp.expertise_level >= 0.8)

    return {
        "role": "STUDENT",
        "totalCourses": len(enrollments),
        "avgAttendance": avg_attendance,
        "avgCT": avg_ct,
        "topicsMastered": topics_mastered,
        "totalTopics": len(topics_all),
    }


# ── Course analytics ──────────────────────────────────────────────────────────

async def get_course_analytics(db: AsyncSession, user_id: str, course_id: str) -> dict:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    course = (await db.execute(select(Course).where(Course.id == course_id))).scalar_one_or_none()

    if user and user.role == Role.TUTOR:
        return await _course_analytics_tutor(db, course_id, course)
    return await _course_analytics_student(db, user_id, course_id, course)


async def _course_analytics_tutor(db: AsyncSession, course_id: str, course: Course | None) -> dict:
    rows = (await db.execute(
        select(Enrollment, User)
        .join(User, Enrollment.user_id == User.id)
        .where(Enrollment.course_id == course_id, User.role == Role.STUDENT)
    )).all()

    student_ids = [u.id for _, u in rows]

    attendance = (await db.execute(
        select(AttendanceRecord)
        .join(ScheduleSlot, AttendanceRecord.slot_id == ScheduleSlot.id)
        .where(
            AttendanceRecord.user_id.in_(student_ids),
            ScheduleSlot.course_id == course_id,
        )
    )).scalars().all() if student_ids else []

    att_by_student: dict[str, dict] = defaultdict(lambda: {"total": 0, "present": 0})
    for a in attendance:
        att_by_student[a.user_id]["total"] += 1
        if a.present:
            att_by_student[a.user_id]["present"] += 1

    students = []
    for enroll, u in rows:
        att = att_by_student[u.id]
        att_pct = round((att["present"] / att["total"]) * 100) if att["total"] else 0
        students.append({
            "userId": u.id,
            "name": u.name,
            "rollNumber": u.roll_number,
            "email": u.email,
            "attendancePercent": att_pct,
            "totalClasses": att["total"],
            "present": att["present"],
            "ctScore1": enroll.ct_score1,
            "ctScore2": enroll.ct_score2,
            "ctScore3": enroll.ct_score3,
            "labScore": enroll.lab_score,
        })

    all_ct = [s for e, _ in rows for s in [e.ct_score1, e.ct_score2, e.ct_score3] if s is not None]
    avg_ct = round(sum(all_ct) / len(all_ct)) if all_ct else 0
    all_lab = [e.lab_score for e, _ in rows if e.lab_score is not None]
    avg_lab = round(sum(all_lab) / len(all_lab)) if all_lab else 0
    total_att = len(attendance)
    total_present = sum(1 for a in attendance if a.present)
    class_att_pct = round((total_present / total_att) * 100) if total_att else 0

    return {
        "role": "TUTOR",
        "courseType": course.course_type if course else "THEORY",
        "students": students,
        "classAverages": {"avgCT": avg_ct, "avgLab": avg_lab, "attendancePercent": class_att_pct},
        "totalStudents": len(rows),
    }


async def _course_analytics_student(db: AsyncSession, user_id: str, course_id: str, course: Course | None) -> dict:
    enrollment = (await db.execute(
        select(Enrollment).where(Enrollment.user_id == user_id, Enrollment.course_id == course_id)
    )).scalar_one_or_none()

    topics = (await db.execute(
        select(Topic).where(Topic.course_id == course_id).order_by(Topic.order_index.asc())
    )).scalars().all()
    topic_ids = [t.id for t in topics]

    progress_map = {tp.topic_id: tp for tp in (await db.execute(
        select(TopicProgress).where(
            TopicProgress.user_id == user_id,
            TopicProgress.topic_id.in_(topic_ids),
        )
    )).scalars().all()} if topic_ids else {}

    attendance_rows = (await db.execute(
        select(AttendanceRecord, ScheduleSlot)
        .join(ScheduleSlot, AttendanceRecord.slot_id == ScheduleSlot.id)
        .where(AttendanceRecord.user_id == user_id, ScheduleSlot.course_id == course_id)
        .order_by(AttendanceRecord.date.asc())
    )).all()

    exams = (await db.execute(
        select(ExamAttempt)
        .where(ExamAttempt.user_id == user_id, ExamAttempt.topic_id.in_(topic_ids))
        .order_by(ExamAttempt.created_at.desc())
    )).scalars().all() if topic_ids else []

    topic_analytics = []
    for t in topics:
        tp = progress_map.get(t.id)
        raw = tp.expertise_level if tp else 0.0
        last_studied = tp.last_studied if tp else None
        decayed = _decayed_expertise(raw, last_studied)
        topic_analytics.append({
            "id": t.id,
            "title": t.title,
            "expertiseLevel": round(decayed * 1000) / 1000,
            "rawExpertise": raw,
            "studyMinutes": tp.study_minutes if tp else 0,
            "examScore": tp.exam_score if tp else None,
            "lastStudied": last_studied,
        })

    attendance_data = [
        {"date": a.date, "present": a.present, "slotType": slot.type, "dayOfWeek": slot.day_of_week}
        for a, slot in attendance_rows
    ]
    present_count = sum(1 for a, _ in attendance_rows if a.present)
    att_pct = round((present_count / len(attendance_rows)) * 100) if attendance_rows else 0

    def _enrollment_dict(e: Enrollment | None) -> dict | None:
        if e is None:
            return None
        return {
            "id": e.id,
            "userId": e.user_id,
            "courseId": e.course_id,
            "ctScore1": e.ct_score1,
            "ctScore2": e.ct_score2,
            "ctScore3": e.ct_score3,
            "labScore": e.lab_score,
        }

    return {
        "courseType": course.course_type if course else "THEORY",
        "enrollment": _enrollment_dict(enrollment),
        "topicAnalytics": topic_analytics,
        "attendanceData": attendance_data,
        "attendancePercentage": att_pct,
        "examHistory": [
            {
                "id": e.id,
                "topicId": e.topic_id,
                "score": round((e.score / e.total_q) * 100) if e.total_q > 0 else 0,
                "totalQ": e.total_q,
                "timeTaken": e.time_taken,
                "createdAt": e.created_at,
            }
            for e in exams
        ],
    }


# ── Attendance / Score mutations ──────────────────────────────────────────────

async def update_attendance(db: AsyncSession, user_id: str, slot_id: str, date: datetime, present: bool) -> dict:
    slot = await db.get(ScheduleSlot, slot_id)
    if not slot:
        raise NotFoundError("Schedule slot not found")

    existing = (await db.execute(
        select(AttendanceRecord).where(
            AttendanceRecord.user_id == user_id,
            AttendanceRecord.slot_id == slot_id,
            AttendanceRecord.date == date,
        )
    )).scalar_one_or_none()

    if existing:
        existing.present = present
        await db.commit()
        record = existing
    else:
        record = AttendanceRecord(user_id=user_id, slot_id=slot_id, date=date, present=present)
        db.add(record)
        await db.commit()
        await db.refresh(record)

    return {
        "id": record.id,
        "userId": record.user_id,
        "slotId": record.slot_id,
        "date": record.date,
        "present": record.present,
    }


async def update_ct_score(db: AsyncSession, enrollment_id: str, ct_score1: float | None, ct_score2: float | None, ct_score3: float | None) -> dict:
    enrollment = await db.get(Enrollment, enrollment_id)
    if not enrollment:
        raise NotFoundError("Enrollment not found")
    if ct_score1 is not None:
        enrollment.ct_score1 = ct_score1
    if ct_score2 is not None:
        enrollment.ct_score2 = ct_score2
    if ct_score3 is not None:
        enrollment.ct_score3 = ct_score3
    await db.commit()
    return {
        "id": enrollment.id,
        "userId": enrollment.user_id,
        "courseId": enrollment.course_id,
        "ctScore1": enrollment.ct_score1,
        "ctScore2": enrollment.ct_score2,
        "ctScore3": enrollment.ct_score3,
        "labScore": enrollment.lab_score,
    }


async def update_lab_score(db: AsyncSession, enrollment_id: str, lab_score: float) -> dict:
    enrollment = await db.get(Enrollment, enrollment_id)
    if not enrollment:
        raise NotFoundError("Enrollment not found")
    enrollment.lab_score = lab_score
    await db.commit()
    return {
        "id": enrollment.id,
        "userId": enrollment.user_id,
        "courseId": enrollment.course_id,
        "ctScore1": enrollment.ct_score1,
        "ctScore2": enrollment.ct_score2,
        "ctScore3": enrollment.ct_score3,
        "labScore": enrollment.lab_score,
    }


# ── Suggestions ───────────────────────────────────────────────────────────────

async def get_suggestions(db: AsyncSession, user_id: str) -> list:
    user = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if user and user.role == Role.TUTOR:
        return []

    enrollments = (await db.execute(
        select(Enrollment).where(Enrollment.user_id == user_id)
    )).scalars().all()
    if not enrollments:
        return []

    course_ids = [e.course_id for e in enrollments]
    courses = {c.id: c for c in (await db.execute(
        select(Course).where(Course.id.in_(course_ids))
    )).scalars().all()}
    enrollment_by_course = {e.course_id: e for e in enrollments}

    topics_all = (await db.execute(
        select(Topic).where(Topic.course_id.in_(course_ids)).order_by(Topic.order_index.asc())
    )).scalars().all()
    topics_by_course: dict[str, list[Topic]] = defaultdict(list)
    for t in topics_all:
        topics_by_course[t.course_id].append(t)

    topic_ids = [t.id for t in topics_all]
    progress_map = {tp.topic_id: tp for tp in (await db.execute(
        select(TopicProgress).where(
            TopicProgress.user_id == user_id,
            TopicProgress.topic_id.in_(topic_ids),
        )
    )).scalars().all()} if topic_ids else {}

    _prio = {"high": 0, "medium": 1, "low": 2}
    suggestions: list[dict] = []

    for course_id, course_topics in topics_by_course.items():
        course = courses.get(course_id)
        if not course:
            continue
        for topic in course_topics:
            tp = progress_map.get(topic.id)
            raw = tp.expertise_level if tp else 0.0
            last_studied = tp.last_studied if tp else None
            expertise = _decayed_expertise(raw, last_studied)

            base = {
                "courseId": course_id,
                "topicId": topic.id,
                "courseName": course.course_name,
                "topicName": topic.title,
                "expertiseLevel": round(expertise * 100) / 100,
            }

            if not tp:
                suggestions.append({
                    **base,
                    "type": "study",
                    "priority": "high",
                    "title": f"Start studying: {topic.title}",
                    "description": f"You haven't started this topic in {course.course_name}",
                })
            elif expertise < 0.3:
                suggestions.append({
                    **base,
                    "type": "study",
                    "priority": "high",
                    "title": f"Review: {topic.title}",
                    "description": f"Your mastery has dropped to {round(expertise * 100)}%",
                })
            elif expertise < 0.6:
                suggestions.append({
                    **base,
                    "type": "exam",
                    "priority": "medium",
                    "title": f"Take a quiz: {topic.title}",
                    "description": f"Test yourself to boost mastery from {round(expertise * 100)}%",
                })
            elif last_studied:
                days_since = (datetime.now(timezone.utc) - _as_utc(last_studied)).total_seconds() / 86400
                if days_since > 14:
                    suggestions.append({
                        **base,
                        "type": "review",
                        "priority": "low",
                        "title": f"Quick review: {topic.title}",
                        "description": f"It's been {round(days_since)} days since you last studied this",
                    })

    suggestions.sort(key=lambda s: _prio[s["priority"]])
    return suggestions[:20]
