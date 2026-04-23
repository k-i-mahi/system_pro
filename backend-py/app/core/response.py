from __future__ import annotations

from typing import Any

from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse


def success(data: Any, meta: dict | None = None) -> JSONResponse:
    body: dict = {"success": True, "data": jsonable_encoder(data)}
    if meta:
        body["meta"] = jsonable_encoder(meta)
    return JSONResponse(content=body)


def created(data: Any) -> JSONResponse:
    return JSONResponse(status_code=201, content={"success": True, "data": jsonable_encoder(data)})


def error(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    err: dict = {"code": code, "message": message}
    if details is not None:
        err["details"] = jsonable_encoder(details)
    return JSONResponse(status_code=status, content={"success": False, "error": err})
