# Build & Run Guide (Current Backend: `backend-py`)

## Prerequisites

- Python 3.11+
- Node.js 20+ (22 recommended)
- Docker + Docker Compose
- Ollama (for local model inference)

## 1) Install Dependencies

```bash
cd backend-py
pip install -r requirements.txt

cd ../frontend
npm install
```

## 2) Start Infrastructure

```bash
cd ..
docker compose up -d postgres redis ai-sidecar
```

## 3) Configure Environment

Create `.env` at repo root (or `backend-py/.env`) with:

```env
DATABASE_URL=postgresql://copilot:copilot@localhost:5433/copilot_db
REDIS_URL=redis://localhost:6379/0
ARQ_REDIS_URL=redis://localhost:6379/2
AUTH_SECRET=change-me
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
AI_SIDECAR_URL=http://localhost:8000
METRICS_KEY=change-me
CORS_ORIGINS=http://localhost:5173
PORT=3001
NODE_ENV=development
EMAIL_PROVIDER=resend
EMAIL_FROM_NAME=Cognitive Copilot
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
EMAIL_REPLY_TO=support@yourdomain.com
RESEND_API_KEY=re_xxxxxxxxx
FRONTEND_URL=http://localhost:5173
```

For production password reset delivery, verify one sending domain once and keep a single shared
sender such as `noreply@yourdomain.com`. Every user email is sent through that sender account; you
do not need to set separate SMTP credentials for each user.

## 4) Run Services (Local Dev)

Backend:

```bash
cd backend-py
python main.py
```

Frontend:

```bash
cd frontend
npm run dev
```

URLs:

- App: `http://localhost:5173`
- API docs: `http://localhost:3001/api/docs`
- Health: `http://localhost:3001/health`

## 5) Run Tests

Backend:

```bash
cd backend-py
pytest -q
```

Frontend:

```bash
cd frontend
npm test -- --run
```

## 6) Production-Style Local Demo

```bash
docker compose --profile prod-local up -d --build
```

Optional port overrides for Caddy:

```env
HTTP_PORT=18080
HTTPS_PORT=18443
```

## 7) Build Validation

```bash
cd frontend
npm run build
```

## 8) Feature Verification

- AI Tutor modes (`chat`, `ask-course`, `explain`, `quiz`, `resources`) load and respond correctly
- Analytics overview and per-course charts return valid data
- Community announcements, marks, attendance, and members tabs all work
- Notification delivery and deep-link navigation are functional
