from __future__ import annotations

import sys

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

_engine_kwargs: dict = {"echo": settings.NODE_ENV == "development"}

# On Windows test runs, asyncpg + pooled connections can hit event-loop/proactor edge cases.
# NullPool keeps test connections isolated and stable.
if sys.platform.startswith("win") and "pytest" in sys.modules:
    _engine_kwargs["poolclass"] = NullPool
else:
    _engine_kwargs["pool_size"] = 10
    _engine_kwargs["max_overflow"] = 20

engine = create_async_engine(settings.async_database_url, **_engine_kwargs)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)
