from __future__ import annotations

from fastapi import HTTPException


class AppError(HTTPException):
    pass


class UnauthorizedError(AppError):
    def __init__(self, message: str = "Unauthorized", code: str = "UNAUTHORIZED") -> None:
        super().__init__(status_code=401, detail={"code": code, "message": message})


class ForbiddenError(AppError):
    def __init__(self, message: str = "Insufficient permissions") -> None:
        super().__init__(status_code=403, detail={"code": "FORBIDDEN", "message": message})


class NotFoundError(AppError):
    def __init__(self, message: str = "Not found") -> None:
        super().__init__(status_code=404, detail={"code": "NOT_FOUND", "message": message})


class ConflictError(AppError):
    def __init__(self, message: str = "A record with this value already exists") -> None:
        super().__init__(status_code=409, detail={"code": "CONFLICT", "message": message})


class ValidationError(AppError):
    def __init__(self, message: str = "Invalid request data", details: list | None = None, code: str = "VALIDATION_ERROR") -> None:
        detail: dict = {"code": code, "message": message}
        if details:
            detail["details"] = details
        super().__init__(status_code=400, detail=detail)


class RateLimitError(AppError):
    def __init__(self, message: str = "Too many requests, try again later") -> None:
        super().__init__(status_code=429, detail={"code": "RATE_LIMIT", "message": message})
