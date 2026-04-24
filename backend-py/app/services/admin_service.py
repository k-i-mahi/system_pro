from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ConflictError, NotFoundError
from app.core.security import hash_password
from app.models.community import Community
from app.models.course import Course
from app.models.user import User


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


async def update_user(db: AsyncSession, user_id: str, data: dict) -> dict:
    user = await db.get(User, user_id)
    if not user:
        raise NotFoundError("User not found")
    if "email" in data and data["email"] != user.email:
        existing = (await db.execute(select(User.id).where(User.email == data["email"]))).scalar_one_or_none()
        if existing:
            raise ConflictError("Email is already in use")

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
    course = (await db.execute(select(Course).where(Course.course_code == data["courseCode"]))).scalar_one_or_none()
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
        created_by=admin_user_id,
    )
    db.add(community)
    await db.commit()
    await db.refresh(community)
    return _community_to_dict(community, course)


async def update_community(db: AsyncSession, community_id: str, data: dict) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    if "courseCode" in data and data["courseCode"]:
        course = (await db.execute(select(Course).where(Course.course_code == data["courseCode"]))).scalar_one_or_none()
        if not course:
            course = Course(course_code=data["courseCode"], course_name=data["courseCode"])
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


async def delete_community(db: AsyncSession, community_id: str) -> dict:
    community = await db.get(Community, community_id)
    if not community:
        raise NotFoundError("Community not found")
    name = community.name
    await db.delete(community)
    await db.commit()
    return {"message": "Community deleted", "deleted": {"id": community_id, "name": name}}
