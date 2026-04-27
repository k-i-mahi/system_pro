from __future__ import annotations

from fastapi import APIRouter

from app.core.deps import DBDep, require_role
from app.core.response import created, success
from app.models.enums import Role
from app.schemas.admin import (
    AdminCreateCommunityRequest,
    AdminCreateThreadRequest,
    AdminCreateUserRequest,
    AdminUpdateCommunityRequest,
    AdminUpdateThreadRequest,
    AdminUpdateUserRequest,
)
from app.services import admin_service

router = APIRouter()


@router.get("/users")
async def list_users(
    db: DBDep,
    _admin_id: str = require_role(Role.ADMIN),
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
    role: str | None = None,
):
    items, total = await admin_service.list_users(db, page, limit, search, role)
    return success(items, meta={"page": page, "limit": limit, "total": total})


@router.post("/users")
async def create_user(body: AdminCreateUserRequest, db: DBDep, _admin_id: str = require_role(Role.ADMIN)):
    data = await admin_service.create_user(db, body.model_dump())
    return created(data)


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    body: AdminUpdateUserRequest,
    db: DBDep,
    admin_id: str = require_role(Role.ADMIN),
):
    data = await admin_service.update_user(db, user_id, body.model_dump(exclude_unset=True), acting_user_id=admin_id)
    return success(data)


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    db: DBDep,
    _admin_id: str = require_role(Role.ADMIN),
    reason: str | None = None,
):
    data = await admin_service.delete_user(db, user_id, reason)
    return success(data)


@router.get("/communities")
async def list_communities(
    db: DBDep,
    _admin_id: str = require_role(Role.ADMIN),
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
):
    items, total = await admin_service.list_communities(db, page, limit, search)
    return success(items, meta={"page": page, "limit": limit, "total": total})


@router.post("/communities")
async def create_community(
    body: AdminCreateCommunityRequest,
    db: DBDep,
    admin_id: str = require_role(Role.ADMIN),
):
    data = await admin_service.create_community(db, admin_id, body.model_dump())
    return created(data)


@router.patch("/communities/{community_id}")
async def update_community(
    community_id: str,
    body: AdminUpdateCommunityRequest,
    db: DBDep,
    _admin_id: str = require_role(Role.ADMIN),
):
    data = await admin_service.update_community(db, community_id, body.model_dump(exclude_unset=True))
    return success(data)


@router.delete("/communities/{community_id}")
async def delete_community(community_id: str, db: DBDep, _admin_id: str = require_role(Role.ADMIN)):
    data = await admin_service.delete_community(db, community_id)
    return success(data)


@router.get("/threads")
async def list_threads(
    db: DBDep,
    _admin_id: str = require_role(Role.ADMIN),
    page: int = 1,
    limit: int = 20,
    search: str | None = None,
):
    items, total = await admin_service.list_threads(db, page, limit, search)
    return success(items, meta={"page": page, "limit": limit, "total": total})


@router.post("/threads")
async def create_thread(body: AdminCreateThreadRequest, db: DBDep, _admin_id: str = require_role(Role.ADMIN)):
    data = await admin_service.create_thread(db, body.model_dump())
    return created(data)


@router.patch("/threads/{thread_id}")
async def update_thread(
    thread_id: str,
    body: AdminUpdateThreadRequest,
    db: DBDep,
    _admin_id: str = require_role(Role.ADMIN),
):
    data = await admin_service.update_thread(db, thread_id, body.model_dump(exclude_unset=True))
    return success(data)


@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str, db: DBDep, _admin_id: str = require_role(Role.ADMIN)):
    data = await admin_service.delete_thread(db, thread_id)
    return success(data)
