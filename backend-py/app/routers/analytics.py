from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.deps import CurrentUserIdDep, DBDep, get_current_user_id
from app.core.response import success
from app.schemas.analytics import (
    UpdateAttendanceRequest,
    UpdateCtScoreRequest,
    UpdateLabScoreRequest,
)
from app.services import analytics_service, evaluation_service

router = APIRouter(dependencies=[Depends(get_current_user_id)])


@router.get("/overview")
async def get_overview(db: DBDep, user_id: CurrentUserIdDep):
    data = await analytics_service.get_overview(db, user_id)
    return success(data)


@router.get("/suggestions")
async def get_suggestions(db: DBDep, user_id: CurrentUserIdDep):
    data = await analytics_service.get_suggestions(db, user_id)
    return success(data)


@router.get("/evaluation")
async def get_evaluation(db: DBDep, user_id: CurrentUserIdDep):
    data = await evaluation_service.get_evaluation_metrics(db, user_id)
    return success(data)


@router.get("/courses/{course_id}")
async def get_course_analytics(course_id: str, db: DBDep, user_id: CurrentUserIdDep):
    data = await analytics_service.get_course_analytics(db, user_id, course_id)
    return success(data)


@router.patch("/attendance")
async def update_attendance(body: UpdateAttendanceRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await analytics_service.update_attendance(db, user_id, body.slotId, body.date, body.present)
    return success(data)


@router.patch("/ct-score")
async def update_ct_score(body: UpdateCtScoreRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await analytics_service.update_ct_score(db, body.enrollmentId, body.ctScore1, body.ctScore2, body.ctScore3)
    return success(data)


@router.patch("/lab-score")
async def update_lab_score(body: UpdateLabScoreRequest, db: DBDep, user_id: CurrentUserIdDep):
    data = await analytics_service.update_lab_score(db, body.enrollmentId, body.labScore)
    return success(data)
