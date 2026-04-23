# CLAUDE.md — Cognitive Copilot System

This file guides Claude Code when working in this repository.

## Project Overview

**Cognitive Copilot** is an AI-powered learning management system for university students.
It combines RAG-based course Q&A, an adaptive AI tutor (ReAct agent), OCR routine scanning,
community features, analytics, and real-time notifications.

**Current backend:** `backend/` — Express.js + TypeScript + Prisma + PostgreSQL + BullMQ + Socket.io
**Target backend:** `backend-py/` — FastAPI + Python + SQLAlchemy + PostgreSQL + ARQ + python-socketio

**Frontend:** `frontend/` — React + Vite + TypeScript (do not touch during migration)
**AI sidecar:** `ai-sidecar/` — Python FastAPI (already Python — reference this for patterns)
**Database:** PostgreSQL with pgvector (embeddings) + tsvector (BM25 full-text search)

---

## Migration Rules (Critical — Read First)

These rules apply for the entire backend-py migration:

1. **Never break the existing `backend/`** — it stays running until `backend-py/` is feature-complete
2. **Exact API contract** — every endpoint, method, path, status code, and response shape must match `backend/` exactly. The frontend must not need any changes.
3. **Same database** — `backend-py/` shares the same PostgreSQL instance. Do not alter the schema. Use Alembic only for new columns if absolutely needed, and only after confirming `backend/` Prisma migrations are applied first.
4. **Same `.env`** — reuse all existing environment variables. Add Python-specific ones (e.g. `CELERY_BROKER_URL`) but never rename existing ones.
5. **Port separation** — `backend/` runs on port 3001; `backend-py/` runs on port 3002 during parallel testing, then takes over 3001 after cutover.
6. **Parity before cutover** — all 11 controllers must be fully ported and tested before switching docker-compose to use `backend-py/`.

---

## Python / FastAPI Conventions

- Python 3.12+, FastAPI 0.115+, SQLAlchemy 2.x (async), Pydantic v2
- `from __future__ import annotations` on every module
- Type hints on all function signatures — no bare `Any`
- No `print()` — use `logging.getLogger(__name__)`
- f-strings only — never `%` or `.format()`
- `pathlib.Path` not `os.path`
- snake_case everywhere except Pydantic model class names (PascalCase)
- Max 120 chars per line (ruff-enforced)
- Imports: stdlib → third-party → local, sorted by ruff

### FastAPI Patterns

```python
# Thin router — business logic in services, not here
@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    return await auth_service.login(db, body)
```

```python
# Pydantic v2 schema — separate request/response models
class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    accessToken: str   # camelCase to match existing JS API contract
    refreshToken: str
    user: UserResponse
```

```python
# Service layer — all business logic here
async def login(db: AsyncSession, body: LoginRequest) -> TokenResponse:
    user = await user_repo.get_by_email(db, body.email)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    ...
```

### Error Handling

Mirror the existing Express error shapes exactly:

```python
# app/core/exceptions.py
from fastapi import HTTPException

class AppError(HTTPException):
    pass

class NotFoundError(AppError):
    def __init__(self, detail: str = "Not found"):
        super().__init__(status_code=404, detail=detail)

class ConflictError(AppError):
    def __init__(self, detail: str = "Conflict"):
        super().__init__(status_code=409, detail=detail)
```

### Auth Middleware

```python
# app/core/security.py
async def get_current_user(
    token: str = Depends(oauth2_scheme),
    redis: Redis = Depends(get_redis),
    db: AsyncSession = Depends(get_db),
) -> User:
    if await redis.get(f"bl:{token}"):
        raise HTTPException(status_code=401, detail="Token revoked")
    payload = decode_jwt(token)
    user = await user_repo.get(db, payload["userId"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
```

---

## File Structure — `backend-py/`

```
backend-py/
  app/
    core/
      config.py          # Pydantic Settings (mirrors env.ts)
      security.py        # JWT encode/decode, password hash/verify
      deps.py            # FastAPI dependencies (get_db, get_redis, get_current_user)
      exceptions.py      # Custom HTTP exceptions
      middleware.py      # Logging, metrics, rate limiting
    models/              # SQLAlchemy ORM models (mirrors prisma/schema.prisma)
      user.py
      course.py
      material.py
      community.py
      llm_call.py
      ...
    schemas/             # Pydantic v2 request/response models
      auth.py
      courses.py
      community.py
      ...
    routers/             # FastAPI routers (one per Express route file)
      auth.py
      courses.py
      ai_tutor.py
      community.py
      notifications.py
      analytics.py
      profile.py
      routine.py
      settings.py
      materials.py
    services/            # Business logic (mirrors src/services/)
      auth_service.py
      rag/
        chunker.py
        embedding.py
        retriever.py
        answer.py
      agent/
        react_loop.py
        strategy.py
        tools/
      ocr_service.py
      cloudinary_service.py
      notification_service.py
    workers/             # ARQ background jobs (mirrors src/jobs/)
      ingest.py
      ocr.py
      email.py
      notification.py
      class_reminder.py
    db/
      session.py         # AsyncSession factory
      base.py            # DeclarativeBase
  alembic/               # DB migrations (add-only — never edit existing)
  tests/
    test_auth.py
    test_courses.py
    ...
  main.py                # FastAPI app factory
  requirements.txt
  Dockerfile
```

---

## Database Strategy

- **SQLAlchemy 2.x async** with `asyncpg` driver
- Models derived 1:1 from `prisma/schema.prisma` — field names converted to snake_case
- pgvector: use `pgvector.sqlalchemy.Vector` column type
- tsvector: use `sqlalchemy.dialects.postgresql.TSVECTOR`
- Raw SQL for hybrid search (vector + BM25) via `text()` — same queries as existing `retriever.service.ts`
- No Alembic autogenerate during migration — write migrations by hand to match Prisma exactly

---

## Key Services to Port

| Express service | Python equivalent |
|---|---|
| `bullmq` workers | `arq` workers |
| `socket.io` | `python-socketio` + `aiohttp` |
| `ioredis` | `redis.asyncio` |
| `pino` logging | `structlog` or `logging` + JSON formatter |
| `prom-client` | `prometheus-fastapi-instrumentator` |
| `tesseract.js` | already in `ai-sidecar/` (call via HTTP) |
| `ollama` HTTP | `httpx.AsyncClient` → `OLLAMA_BASE_URL` |
| `nodemailer` | `aiosmtplib` |
| `cloudinary` SDK | `cloudinary` Python SDK |
| `zod` validation | Pydantic v2 |
| JWT (`jsonwebtoken`) | `python-jose` or `PyJWT` |
| bcryptjs | `passlib[bcrypt]` |

---

## Environment Variables

Reuse all vars from root `.env` / `backend/.env`. Python-specific additions:

```bash
# ARQ (replaces BullMQ)
ARQ_REDIS_URL=redis://localhost:6379/1

# Python backend port
PYTHON_PORT=3002
```

---

## Testing

```bash
# Run all tests
pytest backend-py/tests/ -v --cov=app --cov-report=term-missing

# Run specific router tests
pytest backend-py/tests/test_auth.py -v

# Type check
mypy backend-py/app/

# Lint
ruff check backend-py/
ruff format backend-py/
```

Test each router against the running database (no mocks for DB layer).
Use `httpx.AsyncClient` with `ASGITransport` for integration tests.

---

## API Parity Checklist

Before cutover, every endpoint below must return identical shapes to `backend/`:

- [ ] `POST /api/auth/register`
- [ ] `POST /api/auth/login`
- [ ] `POST /api/auth/refresh`
- [ ] `POST /api/auth/logout`
- [ ] `POST /api/auth/forgot-password`
- [ ] `POST /api/auth/verify-otp`
- [ ] `POST /api/auth/reset-password`
- [ ] `GET  /api/auth/me`
- [ ] All `/api/courses/*` endpoints (8 routes)
- [ ] All `/api/routine/*` endpoints (4 routes)
- [ ] All `/api/ai-tutor/*` endpoints (5 routes)
- [ ] All `/api/community/*` endpoints (12 routes)
- [ ] All `/api/notifications/*` endpoints (5 routes)
- [ ] All `/api/analytics/*` endpoints (7 routes)
- [ ] All `/api/settings/*` endpoints (4 routes)
- [ ] All `/api/profile/*` endpoints (4 routes)
- [ ] `GET  /api/materials/:id`
- [ ] `GET  /health`
- [ ] `GET  /metrics`
- [ ] WebSocket notifications via Socket.io

---

## Git Workflow

- Conventional commits: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`
- Work in `backend-py/` only — never modify `backend/` source during migration
- Small, focused commits per router/service
- All tests pass before each commit

---

## Available Commands

- `/plan` — plan next migration step before implementing
- `/tdd` — test-first for each new router
- `/security-review` — audit auth/JWT/rate-limiting parity
- `/review` — code quality check after each module
