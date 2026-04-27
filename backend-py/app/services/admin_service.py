from __future__ import annotations

from sqlalchemy import delete as sql_delete
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError, ValidationError
from app.core.security import hash_password
from app.models.community import Community, CommunityMember, Thread, ThreadLike, ThreadPost
from app.models.course import Course
from app.models.enums import CommunityRole, Role
from app.models.user import User
from app.services.course_identity import find_course_by_code, normalize_course_code


def _user_to_dict(u: User) -> dict:
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "universityName": u.university_name,
        "role": u.role,
        "rollNumber": u.roll_number,
        "session": u.session,
        "department": u.department,
        "createdAt": u.created_at,
    }


def _community_to_dict(c: Community, course: Course | None) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "courseId": c.course_id,
        "courseCode": c.course_code,
        "courseName": course.course_name if course else c.course_code,
        "session": c.session,
        "department": c.department,
        "university": c.university,
        "createdBy": c.created_by,
        "createdAt": c.created_at,
    }


async def list_users(db: AsyncSession, page: int, limit: int, search: str | None, role: str | None) -> tuple[list[dict], int]:
    stmt = select(User)
    if search:
        q = f"%{search.strip()}%"
        stmt = stmt.where(or_(User.name.ilike(q), User.email.ilike(q), User.university_name.ilike(q)))
    if role:
        stmt = stmt.where(User.role == role)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    users = (
        await db.execute(stmt.order_by(User.created_at.desc()).offset((page - 1) * limit).limit(limit))
    ).scalars().all()
    return [_user_to_dict(u) for u in users], total


async def create_user(db: AsyncSession, data: dict) -> dict:
    existing = (await db.execute(select(User.id).where(User.email == data["email"]))).scalar_one_or_none()
    if existing:
        raise ConflictError("Email is already in use")
    user = User(
        name=data["name"],
        email=data["email"],
        university_name=data["universityName"],
        password_hash=hash_password(data["password"]),
        role=data["role"],
        roll_number=data.get("rollNumber"),
        session=data.get("session"),
        department=data.get("department"),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


async def _count_admins(db: AsyncSession) -> int:
    return (await db.execute(select(func.count()).where(User.role == Role.ADMIN))).scalar_one()


async def update_user(db: AsyncSession, user_id: str, data: dict, acting_user_id: str | None = None) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise NotFoundError("User not found")
    if "email" in data and data["email"] != user.email:
        existing = (await db.execute(select(User.id).where(User.email == data["email"]))).scalar_one_or_none()
        if existing:
            raise ConflictError("Email is already in use")

    new_role = data.get("role")
    if new_role and user.role == Role.ADMIN and new_role != Role.ADMIN:
        admin_count = await _count_admins(db)
        if admin_count <= 1:
            raise ValidationError("Cannot demote the last admin account")
        if acting_user_id and acting_user_id == user_id:
            raise ValidationError("Admins cannot demote themselves")

    field_map = {
        "name": "name",
        "email": "email",
        "universityName": "university_name",
        "role": "role",
        "rollNumber": "roll_number",
        "session": "session",
        "department": "department",
    }
    for key, attr in field_map.items():
        if key in data:
            setattr(user, attr, data[key])
    await db.commit()
    await db.refresh(user)
    return _user_to_dict(user)


async def delete_user(db: AsyncSession, user_id: str, reason: str | None = None) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise NotFoundError("User not found")
    if user.role == Role.ADMIN:
        admin_count = await _count_admins(db)
        if admin_count <= 1:
            raise ValidationError("Cannot delete the last admin account")
    name = user.name
    email = user.email
    await db.delete(user)
    await db.commit()
    return {
        "message": "User account deleted permanently",
        "deleted": {"id": user_id, "name": name, "email": email},
        "reason": reason,
    }


async def list_communities(db: AsyncSession, page: int, limit: int, search: str | None) -> tuple[list[dict], int]:
    stmt = select(Community)
    if search:
        q = f"%{search.strip()}%"
        stmt = stmt.where(or_(Community.name.ilike(q), Community.course_code.ilike(q), Community.university.ilike(q)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        await db.execute(stmt.order_by(Community.created_at.desc()).offset((page - 1) * limit).limit(limit))
    ).scalars().all()
    out: list[dict] = []
    for c in rows:
        course = await db.get(Course, c.course_id)
        out.append(_community_to_dict(c, course))
    return out, total


async def create_community(db: AsyncSession, admin_user_id: str, data: dict) -> dict:
    requested_course_code = normalize_course_code(data["courseCode"])
    course = await find_course_by_code(db, requested_course_code)
    if not course:
        course = Course(course_code=requested_course_code, course_name=requested_course_code)
        db.add(course)
        await db.flush()
    community = Community(
        name=data["name"],
        description=data.get("description"),
        course_id=course.id,
        course_code=course.course_code,
        session=data["session"],
        department=data["department"],
        university=data["university"],
        created_by=admin_user_id,
    )
    db.add(community)
    await db.flush()

    owner_user_id: str | None = data.get("ownerUserId")
    if owner_user_id:
        owner = await db.get(User, owner_user_id)
        if not owner or owner.role != Role.TUTOR:
            raise ValidationError("ownerUserId must reference an existing TUTOR account")
        db.add(CommunityMember(
            community_id=community.id,
            user_id=owner_user_id,
            role=CommunityRole.TUTOR,
        ))

    await db.commit()
    await db.refresh(community)
    return _community_to_dict(community, course)


async def update_community(db: AsyncSession, community_id: str, data: dict) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    if "courseCode" in data and data["courseCode"]:
        requested_course_code = normalize_course_code(data["courseCode"])
        course = await find_course_by_code(db, requested_course_code)
        if not course:
            course = Course(course_code=requested_course_code, course_name=requested_course_code)
            db.add(course)
            await db.flush()
        community.course_id = course.id
        community.course_code = course.course_code
    for key, attr in {
        "name": "name",
        "description": "description",
        "session": "session",
        "department": "department",
        "university": "university",
    }.items():
        if key in data:
            setattr(community, attr, data[key])
    await db.commit()
    await db.refresh(community)
    course = await db.get(Course, community.course_id)
    return _community_to_dict(community, course)


def _thread_admin_dict(
    thread: Thread,
    creator: User | None,
    course: Course | None,
    reply_count: int,
    like_count: int,
) -> dict:
    return {
        "id": thread.id,
        "title": thread.title,
        "body": thread.body,
        "tags": thread.tags or [],
        "courseId": thread.course_id,
        "course": {"courseCode": course.course_code, "courseName": course.course_name} if course else None,
        "creator": {"id": creator.id, "name": creator.name, "email": creator.email} if creator else None,
        "createdAt": thread.created_at,
        "replyCount": reply_count,
        "likeCount": like_count,
    }


async def list_threads(db: AsyncSession, page: int, limit: int, search: str | None) -> tuple[list[dict], int]:
    filters = []
    if search:
        q = f"%{search.strip()}%"
        filters.append(or_(Thread.title.ilike(q), Thread.body.ilike(q)))
    count_stmt = select(func.count(Thread.id))
    if filters:
        count_stmt = count_stmt.where(*filters)
    total = (await db.execute(count_stmt)).scalar_one()
    stmt = select(Thread)
    if filters:
        stmt = stmt.where(*filters)
    threads = (
        await db.execute(stmt.order_by(Thread.created_at.desc()).offset((page - 1) * limit).limit(limit))
    ).scalars().all()
    out: list[dict] = []
    for t in threads:
        creator = await db.get(User, t.creator_id)
        course = await db.get(Course, t.course_id) if t.course_id else None
        reply_count = (
            await db.execute(select(func.count(ThreadPost.id)).where(ThreadPost.thread_id == t.id))
        ).scalar_one()
        like_count = (
            await db.execute(select(func.count(ThreadLike.id)).where(ThreadLike.thread_id == t.id))
        ).scalar_one()
        out.append(_thread_admin_dict(t, creator, course, reply_count, like_count))
    return out, total


async def create_thread(db: AsyncSession, data: dict) -> dict:
    raw = (data.get("creatorUserId") or "").strip()
    if not raw:
        raise ValidationError("creatorUserId is required")
    if "@" in raw:
        creator = (await db.execute(select(User).where(User.email == raw.lower()))).scalar_one_or_none()
        if not creator:
            raise NotFoundError("No user found with that email")
    else:
        creator = await db.get(User, raw)
        if not creator:
            raise NotFoundError("No user found with that user id")
    if creator.role != Role.STUDENT:
        raise ValidationError("Thread creator must be a STUDENT account")
    if data.get("courseId"):
        course = await db.get(Course, data["courseId"])
        if not course:
            raise NotFoundError("Course not found")
    thread = Thread(
        title=data["title"],
        body=data["body"],
        course_id=data.get("courseId"),
        creator_id=creator.id,
        tags=data.get("tags") or [],
    )
    db.add(thread)
    await db.commit()
    await db.refresh(thread)
    course = await db.get(Course, thread.course_id) if thread.course_id else None
    return _thread_admin_dict(thread, creator, course, 0, 0)


async def update_thread(db: AsyncSession, thread_id: str, data: dict) -> dict:
    thread = await db.get(Thread, thread_id)
    if not thread:
        raise NotFoundError("Thread not found")
    if "courseId" in data:
        cid = data["courseId"]
        if cid:
            course = await db.get(Course, cid)
            if not course:
                raise NotFoundError("Course not found")
            thread.course_id = cid
        else:
            thread.course_id = None
    if "title" in data and data["title"] is not None:
        thread.title = data["title"]
    if "body" in data and data["body"] is not None:
        thread.body = data["body"]
    if "tags" in data and data["tags"] is not None:
        thread.tags = data["tags"]
    await db.commit()
    await db.refresh(thread)
    creator = await db.get(User, thread.creator_id)
    course = await db.get(Course, thread.course_id) if thread.course_id else None
    reply_count = (
        await db.execute(select(func.count(ThreadPost.id)).where(ThreadPost.thread_id == thread.id))
    ).scalar_one()
    like_count = (
        await db.execute(select(func.count(ThreadLike.id)).where(ThreadLike.thread_id == thread.id))
    ).scalar_one()
    return _thread_admin_dict(thread, creator, course, reply_count, like_count)


async def delete_thread(db: AsyncSession, thread_id: str) -> dict:
    thread = await db.get(Thread, thread_id)
    if not thread:
        raise NotFoundError("Thread not found")
    title = thread.title
    await db.execute(sql_delete(ThreadPost).where(ThreadPost.thread_id == thread_id))
    await db.execute(sql_delete(ThreadLike).where(ThreadLike.thread_id == thread_id))
    await db.delete(thread)
    await db.commit()
    return {"message": "Thread deleted", "deleted": {"id": thread_id, "title": title}}


async def delete_community(db: AsyncSession, community_id: str) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    name = community.name
    await db.delete(community)
    await db.commit()
    return {"message": "Community deleted", "deleted": {"id": community_id, "name": name}}
