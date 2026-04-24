from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx
import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import UnauthorizedError, ValidationError
from app.models.enums import DayOfWeek, SlotType
from app.schemas.routine import BulkCreateCoursesRequest, BulkCourseInput, SlotInput
from app.services import routine_service

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_CLASSROOM_COURSES_URL = "https://classroom.googleapis.com/v1/courses"
_GOOGLE_CLASSWORK_URL = "https://classroom.googleapis.com/v1/courses/{course_id}/courseWork"
_STATE_TTL_SECONDS = 10 * 60
_SCOPES = [
    "openid",
    "email",
    "profile",
    "https://www.googleapis.com/auth/classroom.courses.readonly",
]


def _require_google_config() -> tuple[str, str, str]:
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET or not settings.GOOGLE_REDIRECT_URI:
        raise ValidationError("Google Classroom is not configured on server")
    return settings.GOOGLE_CLIENT_ID, settings.GOOGLE_CLIENT_SECRET, settings.GOOGLE_REDIRECT_URI


async def create_connect_url(redis: aioredis.Redis, user_id: str) -> str:
    client_id, _client_secret, redirect_uri = _require_google_config()
    state = secrets.token_urlsafe(24)
    await redis.set(f"gclass:state:{state}", user_id, ex=_STATE_TTL_SECONDS)
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "access_type": "offline",
        "prompt": "consent",
        "scope": " ".join(_SCOPES),
        "state": state,
    }
    return f"{_GOOGLE_AUTH_URL}?{urlencode(params)}"


async def handle_callback(redis: aioredis.Redis, code: str, state: str) -> str:
    client_id, client_secret, redirect_uri = _require_google_config()
    user_id = await redis.get(f"gclass:state:{state}")
    if not user_id:
        return f"{settings.FRONTEND_URL}/settings?googleClassroom=error"

    token_payload = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        token_res = await client.post(_GOOGLE_TOKEN_URL, data=token_payload)
    if token_res.status_code >= 400:
        await redis.delete(f"gclass:state:{state}")
        return f"{settings.FRONTEND_URL}/settings?googleClassroom=error"

    token_data = token_res.json()
    expires_in = int(token_data.get("expires_in", 3600))
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=expires_in)).isoformat()
    save_data = {
        "access_token": token_data.get("access_token"),
        "refresh_token": token_data.get("refresh_token"),
        "expires_at": expires_at,
    }
    await redis.set(f"gclass:tokens:{user_id}", json.dumps(save_data), ex=30 * 24 * 60 * 60)
    await redis.delete(f"gclass:state:{state}")
    return f"{settings.FRONTEND_URL}/settings?googleClassroom=connected"


async def _refresh_access_token_if_needed(redis: aioredis.Redis, user_id: str) -> str:
    raw = await redis.get(f"gclass:tokens:{user_id}")
    if not raw:
        raise UnauthorizedError("Google Classroom is not connected", code="GOOGLE_NOT_CONNECTED")
    token_data = json.loads(raw)
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_at_raw = token_data.get("expires_at")
    expires_at = datetime.fromisoformat(expires_at_raw) if expires_at_raw else datetime.now(timezone.utc)

    if access_token and expires_at > datetime.now(timezone.utc) + timedelta(seconds=30):
        return str(access_token)
    if not refresh_token:
        raise UnauthorizedError("Google Classroom connection expired; reconnect required", code="GOOGLE_RECONNECT")

    client_id, client_secret, _redirect_uri = _require_google_config()
    async with httpx.AsyncClient(timeout=30.0) as client:
        token_res = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
    if token_res.status_code >= 400:
        raise UnauthorizedError("Google Classroom token refresh failed", code="GOOGLE_RECONNECT")
    new_data = token_res.json()
    new_access = new_data.get("access_token")
    new_exp = int(new_data.get("expires_in", 3600))
    token_data["access_token"] = new_access
    token_data["expires_at"] = (datetime.now(timezone.utc) + timedelta(seconds=new_exp)).isoformat()
    await redis.set(f"gclass:tokens:{user_id}", json.dumps(token_data), ex=30 * 24 * 60 * 60)
    return str(new_access)


async def list_classrooms(redis: aioredis.Redis, user_id: str) -> list[dict]:
    token = await _refresh_access_token_if_needed(redis, user_id)
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(
            _GOOGLE_CLASSROOM_COURSES_URL,
            headers={"Authorization": f"Bearer {token}"},
            params={"courseStates": ["ACTIVE"]},
        )
    if res.status_code >= 400:
        raise ValidationError("Failed to fetch Google Classroom courses")
    courses = res.json().get("courses", []) or []
    return [
        {
            "id": c.get("id"),
            "name": c.get("name"),
            "section": c.get("section"),
            "descriptionHeading": c.get("descriptionHeading"),
            "alternateLink": c.get("alternateLink"),
            "courseState": c.get("courseState"),
        }
        for c in courses
    ]


def _to_due_iso(due_date: dict | None, due_time: dict | None) -> str | None:
    if not due_date:
        return None
    year = int(due_date.get("year", 0))
    month = int(due_date.get("month", 0))
    day = int(due_date.get("day", 0))
    if not year or not month or not day:
        return None
    hour = int((due_time or {}).get("hours", 0))
    minute = int((due_time or {}).get("minutes", 0))
    second = int((due_time or {}).get("seconds", 0))
    dt = datetime(year, month, day, hour, minute, second, tzinfo=timezone.utc)
    return dt.isoformat()


async def list_assignments(redis: aioredis.Redis, user_id: str, course_id: str) -> list[dict]:
    token = await _refresh_access_token_if_needed(redis, user_id)
    url = _GOOGLE_CLASSWORK_URL.format(course_id=course_id)
    async with httpx.AsyncClient(timeout=30.0) as client:
        res = await client.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params={"courseWorkStates": ["PUBLISHED"]},
        )
    if res.status_code >= 400:
        raise ValidationError("Failed to fetch Google Classroom assignments")
    work = res.json().get("courseWork", []) or []
    return [
        {
            "id": item.get("id"),
            "title": item.get("title"),
            "description": item.get("description"),
            "alternateLink": item.get("alternateLink"),
            "workType": item.get("workType"),
            "state": item.get("state"),
            "dueAt": _to_due_iso(item.get("dueDate"), item.get("dueTime")),
        }
        for item in work
    ]


async def connection_status(redis: aioredis.Redis, user_id: str) -> dict:
    raw = await redis.get(f"gclass:tokens:{user_id}")
    return {"connected": bool(raw)}


async def disconnect(redis: aioredis.Redis, user_id: str) -> None:
    await redis.delete(f"gclass:tokens:{user_id}")


def _iso_to_routine_slot(due_at: str) -> tuple[DayOfWeek, str, str]:
    parsed = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    weekday_map = {
        0: DayOfWeek.MON,
        1: DayOfWeek.TUE,
        2: DayOfWeek.WED,
        3: DayOfWeek.THU,
        4: DayOfWeek.FRI,
        5: DayOfWeek.SAT,
        6: DayOfWeek.SUN,
    }
    day = weekday_map[parsed.weekday()]
    end_time = parsed.strftime("%H:%M")
    start_dt = parsed - timedelta(minutes=40)
    start_time = start_dt.strftime("%H:%M")
    return day, start_time, end_time


async def import_assignment_to_routine(
    db: AsyncSession,
    user_id: str,
    *,
    google_course_id: str,
    google_course_name: str,
    assignment_title: str,
    due_at: str,
) -> dict:
    if not due_at:
        raise ValidationError("This assignment has no due date and cannot be imported to routine")

    day, start_time, end_time = _iso_to_routine_slot(due_at)
    course_code = f"GCL-{google_course_id[-8:]}".upper()
    course_name = f"{google_course_name} - {assignment_title}".strip()
    payload = BulkCreateCoursesRequest(
        courses=[
            BulkCourseInput(
                courseCode=course_code,
                courseName=course_name[:200],
                slots=[
                    SlotInput(
                        dayOfWeek=day,
                        startTime=start_time,
                        endTime=end_time,
                        type=SlotType.CLASS,
                        room="Google Classroom",
                    )
                ],
            )
        ]
    )
    created = await routine_service.bulk_create_courses(db, user_id, payload)
    return {
        "imported": True,
        "course": created[0] if created else None,
        "slot": {"dayOfWeek": day, "startTime": start_time, "endTime": end_time},
    }
