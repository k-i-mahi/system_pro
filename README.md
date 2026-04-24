# Cognitive Copilot

Adaptive LMS + AI tutor with grounded answers, analytics, routine intelligence, and classroom collaboration workflows.

## Current Stack (Synced)

- Frontend: React + TypeScript + Vite (`frontend/`)
- Backend API: FastAPI + SQLAlchemy async (`backend-py/`)
- DB/cache: PostgreSQL + Redis
- AI runtimes: Ollama + AI sidecar (`ai-sidecar/`)
- Deployment: Docker Compose + Caddy

## Quick Start (Dev)

1) Install dependencies:

```bash
cd frontend && npm install
cd ../backend-py && pip install -r requirements.txt
```

2) Start infra:

```bash
cd ..
docker compose up -d postgres redis ai-sidecar
```

3) Configure env (`.env` at repo root, or `backend-py/.env`):

```env
DATABASE_URL=postgresql://copilot:copilot@localhost:5433/copilot_db
REDIS_URL=redis://localhost:6379/0
ARQ_REDIS_URL=redis://localhost:6379/2
AUTH_SECRET=change-me
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
AI_SIDECAR_URL=http://localhost:8000
CORS_ORIGINS=http://localhost:5173
PORT=3001
```

4) Run backend:

```bash
cd backend-py
python main.py
```

Material uploads are indexed asynchronously: run an ARQ worker for `WorkerSettings` in `app/workers/ingest_worker.py` (for example `arq app.workers.ingest_worker.WorkerSettings` from `backend-py/`) alongside the API in production so Redis-backed ingest jobs are processed. If Redis enqueue fails, the API falls back to a local async ingest task.

5) Run frontend:

```bash
cd frontend
npm run dev
```

App: `http://localhost:5173`  
API docs: `http://localhost:3001/api/docs`

## Full Local Demo (Docker)

```bash
docker compose --profile prod-local up -d --build
```

- Frontend via Caddy: `https://localhost`
- API health: `http://localhost:3001/health`
- Caddy ports are configurable:
  - `HTTP_PORT` (default `80`)
  - `HTTPS_PORT` (default `443`)

## Validation Commands

```bash
# Backend
cd backend-py
pytest -q

# Frontend
cd frontend
npm test -- --run
npm run build
```
