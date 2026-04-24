from fastapi import APIRouter

from app.routers.admin import router as admin_router
from app.routers.ai_tutor import router as ai_tutor_router
from app.routers.analytics import router as analytics_router
from app.routers.auth import router as auth_router
from app.routers.community import router as community_router
from app.routers.courses import router as courses_router
from app.routers.google_classroom import router as google_classroom_router
from app.routers.materials import router as materials_router
from app.routers.notifications import router as notifications_router
from app.routers.profile import router as profile_router
from app.routers.routine import router as routine_router
from app.routers.settings import router as settings_router

router = APIRouter()
router.include_router(auth_router, prefix="/auth", tags=["auth"])
router.include_router(admin_router, prefix="/admin", tags=["admin"])
router.include_router(courses_router, prefix="/courses", tags=["courses"])
router.include_router(routine_router, prefix="/routine", tags=["routine"])
router.include_router(notifications_router, prefix="/notifications", tags=["notifications"])
router.include_router(settings_router, prefix="/settings", tags=["settings"])
router.include_router(profile_router, prefix="/profile", tags=["profile"])
router.include_router(analytics_router, prefix="/analytics", tags=["analytics"])
router.include_router(community_router, prefix="/community", tags=["community"])
router.include_router(ai_tutor_router, prefix="/ai-tutor", tags=["ai-tutor"])
router.include_router(materials_router, prefix="/materials", tags=["materials"])
router.include_router(google_classroom_router, prefix="/google-classroom", tags=["google-classroom"])
