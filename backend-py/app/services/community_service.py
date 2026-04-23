from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, ForbiddenError, NotFoundError
from app.models.community import (
    Announcement, Community, CommunityMember, MarkUpload, Thread, ThreadLike, ThreadPost
)
from app.models.course import Course, Enrollment, AttendanceRecord, ScheduleSlot
from app.models.enums import CommunityRole, NotificationType, Role
from app.models.user import User
from app.services import notification_service
from app.services.cloudinary_service import upload_file
from app.services.spreadsheet_service import parse_spreadsheet


# ── Thread helpers ────────────────────────────────────────────────────────────

async def _thread_dict(db: AsyncSession, thread: Thread, user_id: str | None = None) -> dict:
    creator = await db.get(User, thread.creator_id)
    course = await db.get(Course, thread.course_id) if thread.course_id else None
    post_count = (await db.execute(
        select(func.count(ThreadPost.id)).where(ThreadPost.thread_id == thread.id)
    )).scalar_one()
    like_count = (await db.execute(
        select(func.count(ThreadLike.id)).where(ThreadLike.thread_id == thread.id)
    )).scalar_one()
    return {
        "id": thread.id,
        "title": thread.title,
        "body": thread.body,
        "courseId": thread.course_id,
        "tags": thread.tags or [],
        "createdAt": thread.created_at,
        "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
        "course": {"courseCode": course.course_code} if course else None,
        "_count": {"posts": post_count, "likes": like_count},
    }


# ── Threads ───────────────────────────────────────────────────────────────────

async def list_threads(
    db: AsyncSession, user_id: str, tab: str | None, course_id: str | None,
    tag: str | None, page: int, limit: int,
) -> tuple[list[dict], int]:
    stmt = select(Thread)

    if tab == "my-courses":
        enrolled_courses = (await db.execute(
            select(Enrollment.course_id).where(Enrollment.user_id == user_id)
        )).scalars().all()
        stmt = stmt.where(Thread.course_id.in_(enrolled_courses))
    if course_id:
        stmt = stmt.where(Thread.course_id == course_id)
    if tag:
        stmt = stmt.where(Thread.tags.contains([tag]))

    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()
    threads = (await db.execute(
        stmt.order_by(Thread.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    return [await _thread_dict(db, t, user_id) for t in threads], total


async def create_thread(db: AsyncSession, user_id: str, data: dict) -> dict:
    thread = Thread(
        title=data["title"],
        body=data["body"],
        course_id=data.get("courseId"),
        creator_id=user_id,
        tags=data.get("tags", []),
    )
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    return await _thread_dict(db, thread, user_id)


async def get_thread(db: AsyncSession, thread_id: str, user_id: str) -> dict:
    thread = await db.get(Thread, thread_id)
    if not thread:
        raise NotFoundError("Thread not found")

    creator = await db.get(User, thread.creator_id)
    course = await db.get(Course, thread.course_id) if thread.course_id else None

    posts_raw = (await db.execute(
        select(ThreadPost).where(ThreadPost.thread_id == thread_id).order_by(ThreadPost.created_at.asc())
    )).scalars().all()

    posts = []
    for p in posts_raw:
        author = await db.get(User, p.author_id)
        posts.append({
            "id": p.id,
            "content": p.content,
            "fileUrl": p.file_url,
            "createdAt": p.created_at,
            "author": {"id": author.id, "name": author.name, "avatarUrl": author.avatar_url} if author else None,
        })

    user_liked = (await db.execute(
        select(ThreadLike).where(ThreadLike.thread_id == thread_id, ThreadLike.user_id == user_id)
    )).scalar_one_or_none() is not None

    like_count = (await db.execute(
        select(func.count(ThreadLike.id)).where(ThreadLike.thread_id == thread_id)
    )).scalar_one()

    return {
        "id": thread.id,
        "title": thread.title,
        "body": thread.body,
        "courseId": thread.course_id,
        "tags": thread.tags or [],
        "createdAt": thread.created_at,
        "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
        "course": {"courseCode": course.course_code, "courseName": course.course_name} if course else None,
        "posts": posts,
        "likes": [{"userId": user_id}] if user_liked else [],
        "_count": {"posts": len(posts), "likes": like_count},
    }


async def create_post(db: AsyncSession, thread_id: str, user_id: str, content: str, file_url: str | None) -> dict:
    post = ThreadPost(thread_id=thread_id, author_id=user_id, content=content, file_url=file_url)
    db.add(post)
    await db.commit()
    await db.refresh(post)
    author = await db.get(User, user_id)
    return {
        "id": post.id,
        "content": post.content,
        "fileUrl": post.file_url,
        "createdAt": post.created_at,
        "author": {"id": author.id, "name": author.name, "avatarUrl": author.avatar_url} if author else None,
    }


async def delete_thread(db: AsyncSession, thread_id: str, user_id: str) -> dict:
    thread = await db.get(Thread, thread_id)
    if not thread:
        raise NotFoundError("Thread not found")
    if thread.creator_id != user_id:
        raise ForbiddenError("You can only delete your own threads")
    await db.delete(thread)
    await db.commit()
    return {"message": "Thread deleted"}


async def like_thread(db: AsyncSession, thread_id: str, user_id: str) -> dict:
    existing = (await db.execute(
        select(ThreadLike).where(ThreadLike.thread_id == thread_id, ThreadLike.user_id == user_id)
    )).scalar_one_or_none()
    if existing:
        return {"liked": True, "message": "Already liked"}
    db.add(ThreadLike(thread_id=thread_id, user_id=user_id))
    await db.commit()
    return {"liked": True}


async def unlike_thread(db: AsyncSession, thread_id: str, user_id: str) -> dict:
    existing = (await db.execute(
        select(ThreadLike).where(ThreadLike.thread_id == thread_id, ThreadLike.user_id == user_id)
    )).scalar_one_or_none()
    if existing:
        await db.delete(existing)
        await db.commit()
    return {"liked": False}


# ── Community CRUD ────────────────────────────────────────────────────────────

async def create_community(db: AsyncSession, user_id: str, data: dict) -> dict:
    course = (await db.execute(
        select(Course).where(Course.course_code == data["courseCode"])
    )).scalar_one_or_none()
    if not course:
        course = Course(course_code=data["courseCode"], course_name=data["courseCode"])
        db.add(course)
        await db.flush()

    community = Community(
        name=data["name"],
        description=data.get("description"),
        course_id=course.id,
        course_code=data["courseCode"],
        session=data["session"],
        department=data["department"],
        university=data["university"],
        created_by=user_id,
    )
    db.add(community)
    await db.flush()

    db.add(CommunityMember(community_id=community.id, user_id=user_id, role=CommunityRole.TUTOR))

    existing_enrollment = (await db.execute(
        select(Enrollment).where(Enrollment.user_id == user_id, Enrollment.course_id == course.id)
    )).scalar_one_or_none()
    if not existing_enrollment:
        db.add(Enrollment(user_id=user_id, course_id=course.id))

    await db.commit()
    await db.refresh(community)

    creator = await db.get(User, user_id)
    member_count = (await db.execute(
        select(func.count(CommunityMember.id)).where(CommunityMember.community_id == community.id)
    )).scalar_one()

    return {
        "id": community.id,
        "name": community.name,
        "description": community.description,
        "courseId": community.course_id,
        "courseCode": community.course_code,
        "session": community.session,
        "department": community.department,
        "university": community.university,
        "createdAt": community.created_at,
        "course": {"courseCode": course.course_code, "courseName": course.course_name},
        "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
        "_count": {"members": member_count},
    }


async def list_communities(
    db: AsyncSession, user_id: str, tab: str | None, page: int, limit: int
) -> tuple[list[dict], int]:
    stmt = select(Community)

    if tab == "my":
        member_subq = select(CommunityMember.community_id).where(CommunityMember.user_id == user_id).scalar_subquery()
        stmt = stmt.where(Community.id.in_(member_subq))
    elif tab == "eligible":
        user = await db.get(User, user_id)
        university = user.university_name if user else None
        not_member_subq = select(CommunityMember.community_id).where(CommunityMember.user_id == user_id).scalar_subquery()
        stmt = stmt.where(Community.university == university, Community.id.notin_(not_member_subq))

    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    communities = (await db.execute(
        stmt.order_by(Community.created_at.desc()).offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    result = []
    for c in communities:
        creator = await db.get(User, c.created_by)
        course = await db.get(Course, c.course_id)
        member_count = (await db.execute(
            select(func.count(CommunityMember.id)).where(CommunityMember.community_id == c.id)
        )).scalar_one()
        result.append({
            "id": c.id, "name": c.name, "description": c.description,
            "courseId": c.course_id, "courseCode": c.course_code,
            "session": c.session, "department": c.department, "university": c.university,
            "createdAt": c.created_at,
            "course": {"courseCode": course.course_code, "courseName": course.course_name} if course else None,
            "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
            "_count": {"members": member_count},
        })
    return result, total


async def get_community(db: AsyncSession, community_id: str) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")

    creator = await db.get(User, community.created_by)
    course = await db.get(Course, community.course_id)
    members_raw = (await db.execute(
        select(CommunityMember).where(CommunityMember.community_id == community_id).order_by(CommunityMember.joined_at.asc())
    )).scalars().all()

    members = []
    for m in members_raw:
        u = await db.get(User, m.user_id)
        members.append({
            "id": m.id, "userId": m.user_id, "communityId": m.community_id, "role": m.role, "joinedAt": m.joined_at,
            "user": {"id": u.id, "name": u.name, "avatarUrl": u.avatar_url, "rollNumber": u.roll_number, "email": u.email} if u else None,
        })

    ann_count = (await db.execute(
        select(func.count(Announcement.id)).where(Announcement.community_id == community_id)
    )).scalar_one()

    return {
        "id": community.id, "name": community.name, "description": community.description,
        "courseId": community.course_id, "courseCode": community.course_code,
        "session": community.session, "department": community.department, "university": community.university,
        "createdAt": community.created_at,
        "course": {"id": course.id, "courseCode": course.course_code, "courseName": course.course_name} if course else None,
        "creator": {"id": creator.id, "name": creator.name, "avatarUrl": creator.avatar_url} if creator else None,
        "members": members,
        "_count": {"members": len(members), "announcements": ann_count},
    }


async def join_community(db: AsyncSession, community_id: str, user_id: str, roll_number: str, session: str, department: str) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")

    user = await db.get(User, user_id)
    if user and user.university_name != community.university:
        raise ForbiddenError("University does not match this classroom")
    if session != community.session:
        raise ForbiddenError("Session does not match this classroom")
    if department != community.department:
        raise ForbiddenError("Department does not match this classroom")

    existing = (await db.execute(
        select(CommunityMember).where(CommunityMember.community_id == community_id, CommunityMember.user_id == user_id)
    )).scalar_one_or_none()
    if existing:
        raise ConflictError("Already a member of this community")

    if user:
        user.roll_number = roll_number
        user.session = session
        user.department = department

    member = CommunityMember(community_id=community_id, user_id=user_id, role=CommunityRole.STUDENT)
    db.add(member)

    existing_enrollment = (await db.execute(
        select(Enrollment).where(Enrollment.user_id == user_id, Enrollment.course_id == community.course_id)
    )).scalar_one_or_none()
    if not existing_enrollment:
        db.add(Enrollment(user_id=user_id, course_id=community.course_id))

    await db.commit()
    await db.refresh(member)
    return {"id": member.id, "userId": member.user_id, "communityId": member.community_id, "role": member.role, "joinedAt": member.joined_at}


async def leave_community(db: AsyncSession, community_id: str, user_id: str) -> dict:
    member = (await db.execute(
        select(CommunityMember).where(CommunityMember.community_id == community_id, CommunityMember.user_id == user_id)
    )).scalar_one_or_none()
    if member:
        await db.delete(member)
        await db.commit()
    return {"message": "Left community"}


async def remove_member(db: AsyncSession, community_id: str, target_user_id: str, requester_id: str) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    if community.created_by != requester_id:
        raise ForbiddenError("Only the community creator can remove members")
    member = (await db.execute(
        select(CommunityMember).where(CommunityMember.community_id == community_id, CommunityMember.user_id == target_user_id)
    )).scalar_one_or_none()
    if member:
        await db.delete(member)
        await db.commit()
    return {"message": "Member removed"}


# ── Announcements ─────────────────────────────────────────────────────────────

async def create_announcement(db: AsyncSession, community_id: str, user_id: str, title: str, body: str, file_url: str | None) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    if community.created_by != user_id:
        raise ForbiddenError("Only the community tutor can post announcements")

    announcement = Announcement(community_id=community_id, author_id=user_id, title=title, body=body, file_url=file_url)
    db.add(announcement)
    await db.flush()

    student_ids = (await db.execute(
        select(CommunityMember.user_id).where(
            CommunityMember.community_id == community_id,
            CommunityMember.role == CommunityRole.STUDENT,
        )
    )).scalars().all()

    for sid in student_ids:
        await notification_service.create_notification(
            db, sid, NotificationType.ANNOUNCEMENT,
            f"New announcement in {community.name}", title,
            metadata={"communityId": community.id, "announcementId": announcement.id},
        )

    await db.commit()
    await db.refresh(announcement)
    author = await db.get(User, user_id)
    return {
        "id": announcement.id, "title": announcement.title, "body": announcement.body,
        "fileUrl": announcement.file_url, "communityId": announcement.community_id,
        "createdAt": announcement.created_at,
        "author": {"id": author.id, "name": author.name, "avatarUrl": author.avatar_url} if author else None,
    }


async def list_announcements(db: AsyncSession, community_id: str, page: int, limit: int) -> tuple[list[dict], int]:
    total = (await db.execute(
        select(func.count(Announcement.id)).where(Announcement.community_id == community_id)
    )).scalar_one()
    announcements = (await db.execute(
        select(Announcement).where(Announcement.community_id == community_id)
        .order_by(Announcement.created_at.desc())
        .offset((page - 1) * limit).limit(limit)
    )).scalars().all()

    result = []
    for a in announcements:
        author = await db.get(User, a.author_id)
        result.append({
            "id": a.id, "title": a.title, "body": a.body, "fileUrl": a.file_url,
            "createdAt": a.created_at,
            "author": {"id": author.id, "name": author.name, "avatarUrl": author.avatar_url} if author else None,
        })
    return result, total


async def delete_announcement(db: AsyncSession, announcement_id: str, user_id: str) -> dict:
    ann = await db.get(Announcement, announcement_id)
    if not ann:
        raise NotFoundError("Announcement not found")
    if ann.author_id != user_id:
        raise ForbiddenError("Only the author can delete this announcement")
    await db.delete(ann)
    await db.commit()
    return {"message": "Announcement deleted"}


# ── Marks ─────────────────────────────────────────────────────────────────────

async def upload_marks(db: AsyncSession, community_id: str, user_id: str, file_data: bytes, filename: str) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    if community.created_by != user_id:
        raise ForbiddenError("Only the community tutor can upload marks")

    upload_result = await upload_file(file_data, "mark-uploads")
    secure_url = upload_result["secure_url"]

    parse_result = parse_spreadsheet(file_data, filename)

    if not parse_result.records:
        mark_upload = MarkUpload(
            community_id=community_id, uploaded_by=user_id, file_url=secure_url,
            processed_count=0, error_count=len(parse_result.errors),
            errors=[{"row": e.row, "rollNumber": e.roll_number, "reason": e.reason} for e in parse_result.errors],
        )
        db.add(mark_upload)
        await db.commit()
        return {"upload": {"id": mark_upload.id}, "processed": 0, "updated": 0, "errors": []}

    updated = 0
    match_errors = []

    for record in parse_result.records:
        student = (await db.execute(
            select(User).where(User.roll_number == record.roll_number, User.university_name == community.university)
        )).scalar_one_or_none()

        if not student:
            match_errors.append({"row": record.row, "rollNumber": record.roll_number, "reason": "No matching student found"})
            continue

        enrollment = (await db.execute(
            select(Enrollment).where(Enrollment.user_id == student.id, Enrollment.course_id == community.course_id)
        )).scalar_one_or_none()

        if not enrollment:
            match_errors.append({"row": record.row, "rollNumber": record.roll_number, "reason": "Student not enrolled in this course"})
            continue

        if record.ct_score1 is not None:
            enrollment.ct_score1 = record.ct_score1
        if record.ct_score2 is not None:
            enrollment.ct_score2 = record.ct_score2
        if record.ct_score3 is not None:
            enrollment.ct_score3 = record.ct_score3
        if record.lab_score is not None:
            enrollment.lab_score = record.lab_score

        updated += 1

    all_errors = [{"row": e.row, "rollNumber": e.roll_number, "reason": e.reason} for e in parse_result.errors] + match_errors
    mark_upload = MarkUpload(
        community_id=community_id, uploaded_by=user_id, file_url=secure_url,
        processed_count=len(parse_result.records),
        error_count=len(all_errors),
        errors=all_errors if all_errors else None,
    )
    db.add(mark_upload)
    await db.commit()

    return {"upload": {"id": mark_upload.id}, "processed": len(parse_result.records), "updated": updated, "errors": all_errors}


async def get_marks_history(db: AsyncSession, community_id: str) -> list[dict]:
    uploads = (await db.execute(
        select(MarkUpload).where(MarkUpload.community_id == community_id).order_by(MarkUpload.created_at.desc())
    )).scalars().all()
    result = []
    for u in uploads:
        uploader = await db.get(User, u.uploaded_by)
        result.append({
            "id": u.id, "fileUrl": u.file_url, "processedCount": u.processed_count,
            "errorCount": u.error_count, "errors": u.errors, "createdAt": u.created_at,
            "uploader": {"id": uploader.id, "name": uploader.name} if uploader else None,
        })
    return result


async def get_community_scores(db: AsyncSession, community_id: str) -> list[dict]:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    enrollments = (await db.execute(
        select(Enrollment).where(Enrollment.course_id == community.course_id)
    )).scalars().all()
    result = []
    for e in enrollments:
        u = await db.get(User, e.user_id)
        result.append({
            "userId": e.user_id,
            "name": u.name if u else None,
            "rollNumber": u.roll_number if u else None,
            "email": u.email if u else None,
            "ctScore1": e.ct_score1,
            "ctScore2": e.ct_score2,
            "ctScore3": e.ct_score3,
            "labScore": e.lab_score,
        })
    return result


# ── Attendance ────────────────────────────────────────────────────────────────

async def record_attendance(
    db: AsyncSession, community_id: str, user_id: str,
    slot_id: str, date_str: str, records: list[dict],
) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    if community.created_by != user_id:
        raise ForbiddenError("Only the community tutor can record attendance")

    attendance_date = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    results = []

    for rec in records:
        existing = (await db.execute(
            select(AttendanceRecord).where(
                AttendanceRecord.user_id == rec["userId"],
                AttendanceRecord.slot_id == slot_id,
                AttendanceRecord.date == attendance_date,
            )
        )).scalar_one_or_none()

        if existing:
            existing.present = rec["present"]
        else:
            existing = AttendanceRecord(
                user_id=rec["userId"], slot_id=slot_id, date=attendance_date, present=rec["present"]
            )
            db.add(existing)
            await db.flush()

        results.append(existing)

        if not rec["present"]:
            await notification_service.create_notification(
                db, rec["userId"], NotificationType.ATTENDANCE_ALERT,
                "Marked absent",
                f"You were marked absent in {community.name} on {attendance_date.strftime('%Y-%m-%d')}",
                metadata={"communityId": community.id, "slotId": slot_id, "date": date_str},
            )

    await db.commit()
    return {"recorded": len(results)}


async def get_community_attendance(
    db: AsyncSession, community_id: str,
    slot_id: str | None, from_date: str | None, to_date: str | None,
) -> list[dict]:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")

    stmt = (
        select(AttendanceRecord, User, ScheduleSlot)
        .join(User, AttendanceRecord.user_id == User.id)
        .join(ScheduleSlot, AttendanceRecord.slot_id == ScheduleSlot.id)
        .where(ScheduleSlot.course_id == community.course_id)
    )
    if slot_id:
        stmt = stmt.where(AttendanceRecord.slot_id == slot_id)
    if from_date:
        stmt = stmt.where(AttendanceRecord.date >= datetime.fromisoformat(from_date.replace("Z", "+00:00")))
    if to_date:
        stmt = stmt.where(AttendanceRecord.date <= datetime.fromisoformat(to_date.replace("Z", "+00:00")))
    stmt = stmt.order_by(AttendanceRecord.date.desc())

    rows = (await db.execute(stmt)).all()
    return [
        {
            "id": a.id, "date": a.date, "present": a.present,
            "user": {"id": u.id, "name": u.name, "rollNumber": u.roll_number},
            "slot": {"dayOfWeek": s.day_of_week, "startTime": s.start_time, "endTime": s.end_time, "type": s.type},
        }
        for a, u, s in rows
    ]


async def get_my_attendance(db: AsyncSession, community_id: str, user_id: str) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")

    rows = (await db.execute(
        select(AttendanceRecord, ScheduleSlot)
        .join(ScheduleSlot, AttendanceRecord.slot_id == ScheduleSlot.id)
        .where(AttendanceRecord.user_id == user_id, ScheduleSlot.course_id == community.course_id)
        .order_by(AttendanceRecord.date.desc())
    )).all()

    records = [
        {"id": a.id, "date": a.date, "present": a.present, "slot": {"dayOfWeek": s.day_of_week, "startTime": s.start_time, "endTime": s.end_time, "type": s.type}}
        for a, s in rows
    ]
    total = len(records)
    present = sum(1 for r in records if r["present"])
    return {
        "records": records,
        "summary": {"total": total, "present": present, "absent": total - present, "percentage": round((present / total) * 100) if total else 0},
    }
