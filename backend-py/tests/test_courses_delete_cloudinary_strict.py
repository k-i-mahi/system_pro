"""Topic/material delete: Cloudinary failure must not remove DB rows (fail-closed)."""
from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select

from app.core.exceptions import ServiceUnavailableError
from app.db.session import AsyncSessionLocal
from app.models.course import Course, Material, Topic
from app.models.enums import MaterialType, TopicStatus
from app.services import courses_service


@pytest.mark.asyncio
async def test_delete_topic_aborts_when_cloudinary_destroy_fails(mocker) -> None:
    mocker.patch(
        "app.services.courses_service.cloudinary_service.destroy_public_id_strict",
        side_effect=ServiceUnavailableError("cloudinary down"),
    )

    async with AsyncSessionLocal() as db:
        course = Course(course_code=f"DEL{uuid.uuid4().hex[:6]}", course_name="Delete Test Course")
        db.add(course)
        await db.flush()
        topic = Topic(
            course_id=course.id,
            title="T1",
            order_index=0,
            status=TopicStatus.NOT_STARTED,
            is_personal=False,
        )
        db.add(topic)
        await db.flush()
        mat = Material(
            topic_id=topic.id,
            title="doc",
            file_url="https://example.com/x",
            file_type=MaterialType.PDF,
            public_id="materials_test/public_id_xyz",
        )
        db.add(mat)
        await db.commit()
        tid, mid, cid = topic.id, mat.id, course.id

        with pytest.raises(ServiceUnavailableError):
            await courses_service.delete_topic(db, tid)

        await db.rollback()
        still = (await db.execute(select(Topic).where(Topic.id == tid))).scalar_one_or_none()
        assert still is not None
        await db.execute(delete(Material).where(Material.id == mid))
        await db.execute(delete(Topic).where(Topic.id == tid))
        await db.execute(delete(Course).where(Course.id == cid))
        await db.commit()
