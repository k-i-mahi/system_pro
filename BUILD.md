# Build & Run Guide

## Prerequisites

- **Node.js** v20+ (v22 recommended)
- **Docker** & **Docker Compose** (for PostgreSQL and Redis)
- **Ollama** (for local AI/LLM features) — https://ollama.com

## 1. Clone & Install

```bash
git clone <repo-url> system-cognitive-copilot
cd system-cognitive-copilot
```

Install dependencies for both backend and frontend:

```bash
cd backend && npm install
cd ../frontend && npm install
```

## 2. Start Infrastructure

From the project root, start PostgreSQL 15 and Redis 7 via Docker Compose:

```bash
docker-compose up -d
```

This starts:

| Service    | Port  | Credentials            |
|------------|-------|------------------------|
| PostgreSQL | 5432  | `copilot` / `copilot`  |
| Redis      | 6379  | no auth                |

## 3. Configure Environment

### Root `.env`

Create `.env` in the project root with:

```env
DATABASE_URL=postgresql://copilot:copilot@localhost:5432/copilot_db
REDIS_URL=redis://localhost:6379/0
AUTH_SECRET=<generate-with: openssl rand -base64 32>
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
PORT=3001
CORS_ORIGINS=http://localhost:5173
NODE_ENV=development
```

### Backend `.env`

Create `backend/.env` — values here override the root `.env`:

```env
DATABASE_URL=postgresql://copilot:copilot@localhost:5432/copilot_db
REDIS_URL=redis://localhost:6379/0
AUTH_SECRET=<same-secret-as-root>
```

### Optional variables

| Variable               | Default                       | Description                     |
|------------------------|-------------------------------|---------------------------------|
| `CLOUDINARY_CLOUD_NAME`| —                             | Cloudinary image uploads        |
| `CLOUDINARY_API_KEY`   | —                             | Cloudinary API key              |
| `CLOUDINARY_API_SECRET`| —                             | Cloudinary API secret           |
| `SMTP_HOST`            | —                             | Email sending (SMTP server)     |
| `SMTP_PORT`            | `587`                         | SMTP port                       |
| `SMTP_USER`            | —                             | SMTP username                   |
| `SMTP_PASS`            | —                             | SMTP password                   |
| `SMTP_FROM`            | `noreply@cognitivecopilot.com`| Sender address                  |

## 4. Set Up the Database

```bash
cd backend

# Run Prisma migrations
npx prisma migrate dev

# Seed sample data (test user, courses, topics, routine slots)
npm run db:seed
```

This creates a test user:

| Field    | Value                |
|----------|----------------------|
| Email    | `student@copilot.dev`|
| Password | `Password123`        |

### Other database commands

```bash
npm run db:push      # Push schema without creating a migration
npm run db:studio    # Open Prisma Studio (visual DB browser)
```

## 5. Pull an Ollama Model

The AI Tutor chat requires a local LLM. Pull the configured model:

```bash
ollama pull llama3.2
```

> You can change the model by setting `OLLAMA_MODEL` in your `.env`.

## 6. Run in Development

Open **two terminals**:

### Terminal 1 — Backend (Express + TypeScript)

```bash
cd backend
npm run dev
```

Starts on **http://localhost:3001** with hot-reload via `tsx watch`.

API docs available at **http://localhost:3001/api/docs** (Swagger UI).

### Terminal 2 — Frontend (React + Vite)

```bash
cd frontend
npm run dev
```

Starts on **http://localhost:5173** with HMR.

The Vite dev server proxies `/api` requests to the backend automatically.

## 7. Production Build

### Backend

```bash
cd backend
npm run build          # Compiles TypeScript → dist/
npm start              # Runs dist/index.js
```

### Frontend

```bash
cd frontend
npm run build          # TypeScript check + Vite build → dist/
npm run preview        # Preview the production build locally
```

## 8. Run Tests

### Backend

```bash
cd backend
npm test               # Run once
npm run test:watch     # Watch mode
```

### Frontend

```bash
cd frontend
npm test               # Run once
npm run test:watch     # Watch mode
```

## 9. Lint (Frontend)

```bash
cd frontend
npm run lint
```

## Project Structure

```
system-cognitive-copilot/
├── docker-compose.yml          # PostgreSQL + Redis
├── .env                        # Root environment variables
├── backend/
│   ├── .env                    # Backend overrides
│   ├── prisma/                 # Schema, migrations, seed
│   ├── src/
│   │   ├── index.ts            # Express app entry point
│   │   ├── config/             # DB, Redis, Cloudinary, Socket.IO, env
│   │   ├── controllers/        # Route handlers
│   │   ├── middleware/         # Auth, validation, rate limiting, errors
│   │   ├── routes/             # Express route definitions
│   │   ├── services/           # Business logic (OCR, Ollama, search, etc.)
│   │   ├── utils/              # JWT, password hashing, response helpers
│   │   ├── validators/         # Zod request schemas
│   │   └── jobs/               # BullMQ workers (email, notifications)
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── App.tsx             # Router & layout
│   │   ├── lib/                # Axios client, utilities
│   │   ├── stores/             # Zustand state (auth, UI)
│   │   ├── components/         # Shared components
│   │   └── pages/              # Feature pages (9 modules)
│   └── tests/
└── figma-template/             # Design reference
```

## Tech Stack

| Layer      | Technology                                            |
|------------|-------------------------------------------------------|
| Frontend   | React 19, TypeScript, Vite, TailwindCSS, TanStack Query, Zustand |
| Backend    | Express, TypeScript, Prisma ORM, Socket.IO, BullMQ   |
| Database   | PostgreSQL 15                                         |
| Cache/Queue| Redis 7                                               |
| AI         | Ollama (local LLM inference)                          |
| Testing    | Vitest, Testing Library, Supertest                    |
