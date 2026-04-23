from __future__ import annotations

import asyncio
import logging
import sys

import socketio
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from slowapi.errors import RateLimitExceeded

from app.core.config import settings
from app.core.exceptions import AppError
from app.core.rate_limit import limiter, rate_limit_exceeded_handler
from app.core.socket import sio
from app.routers import router

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Work around asyncio/proactor instability on Windows test runs.
if sys.platform.startswith("win"):
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())


def create_app() -> FastAPI:
    _app = FastAPI(
        title="Cognitive Copilot API",
        version="1.0.0",
        description="Academic LMS Platform API",
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redirect_slashes=False,
    )

    _app.state.limiter = limiter
    _app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

    _app.add_middleware(
        CORSMiddleware,
        allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",")],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @_app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        detail = exc.detail
        if isinstance(detail, dict):
            return JSONResponse(status_code=exc.status_code, content={"success": False, "error": detail})
        return JSONResponse(
            status_code=exc.status_code,
            content={"success": False, "error": {"code": "ERROR", "message": str(detail)}},
        )

    @_app.exception_handler(RequestValidationError)
    async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Normalize Pydantic validation payload into JSON-safe primitives.
        details = jsonable_encoder(exc.errors())
        return JSONResponse(
            status_code=422,
            content={
                "success": False,
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": "Invalid request data",
                    "details": details,
                },
            },
        )

    @_app.exception_handler(Exception)
    async def generic_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error: %s", exc)
        msg = str(exc) if settings.NODE_ENV != "production" else "Internal server error"
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": {"code": "INTERNAL_ERROR", "message": msg}},
        )

    _app.include_router(router, prefix="/api")

    @_app.get("/health", include_in_schema=False)
    async def health() -> dict:
        from datetime import datetime, timezone
        return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}

    @_app.get("/metrics", include_in_schema=False)
    async def metrics(request: Request) -> Response:
        key = request.headers.get("x-metrics-key", "")
        if key != settings.METRICS_KEY:
            return JSONResponse(status_code=403, content={"error": "Forbidden"})
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return _app


# FastAPI application — used for direct HTTP routing
app = create_app()

# ASGI application — wraps FastAPI with Socket.io; this is what uvicorn serves
socket_app = socketio.ASGIApp(sio, app)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:socket_app",
        host="0.0.0.0",
        port=settings.PORT,
        reload=settings.NODE_ENV == "development",
    )
