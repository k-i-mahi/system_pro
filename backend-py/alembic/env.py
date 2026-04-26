from __future__ import annotations

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Import settings so DATABASE_URL is available.
from app.core.config import settings

# Import Base and ALL models so autogenerate can see every table.
from app.db.base import Base
import app.models.user  # noqa: F401
import app.models.course  # noqa: F401
import app.models.community  # noqa: F401
import app.models.misc  # noqa: F401

config = context.config

# Override sqlalchemy.url with the value from settings (sync URL for Alembic).
# Alembic uses a sync engine for migrations, so strip the asyncpg driver if present.
_db_url = settings.DATABASE_URL
if _db_url.startswith("postgres://"):
    _db_url = _db_url.replace("postgres://", "postgresql://", 1)
config.set_main_option("sqlalchemy.url", _db_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    # Build a *sync* engine from the async URL for Alembic.
    # We use the standard psycopg2-compatible URL (postgresql://).
    from sqlalchemy import create_engine
    sync_url = config.get_main_option("sqlalchemy.url")
    # Alembic needs a sync driver; use psycopg2 if available, else fall back
    # to a synchronous-dialect approach. Since psycopg2 may not be installed,
    # we wrap the async approach using greenlet support.
    connectable = async_engine_from_config(
        {
            "sqlalchemy.url": settings.async_database_url,
        },
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
