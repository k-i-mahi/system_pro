# Cognitive Copilot

> An adaptive, local-first AI tutor that **cites its sources**.
> Built for KUET CSE 3200 (System Development Project) by **Khadimul Islam Mahi** (2107076) and **Sumaiya Akter** (2107080), supervised by **Prof. Md. Nazirul Hasan Shawon**.

Cognitive Copilot is a full-stack academic LMS + tutor that runs entirely on your own machine. No cloud LLM APIs. Upload lecture PDFs, scanned notes, and handwritten derivations — and the system grounds every answer in the exact page and section of your materials.

---

## Highlights

| Workstream | What's inside |
|---|---|
| **Grounded RAG Q&A** | `nomic-embed-text` (768-dim) + `pgvector` + BM25 hybrid retrieval with reciprocal rank fusion. Every answer emits `[n]` citations pinned to a material, page, and heading. |
| **Advanced OCR** | Python FastAPI sidecar with **TrOCR** (handwriting), **Nougat** (academic PDF → LaTeX), **Unstructured** (layout). Tesseract/pdf-parse stays as the zero-dependency fallback. |
| **Socratic agent** | Prompt hierarchy + 5 pedagogical strategies (Explain · Socratic · Hint Ladder · Worked Example · Misconception Probe) with a deterministic selector and a ReAct loop with 5 tools. |
| **Bayesian mastery** | Per-topic Beta posterior replaces the naive `+0.1 / −0.05` rule. 95 % credible intervals surface real uncertainty in the UI. |
| **LLM observability** | `LlmCall` table, `withLogging` wrapper, Pino JSON logs, `prom-client` `/metrics`, and an instructor-facing `/analytics/evaluation` dashboard. |
| **Eval harness** | Golden RAG dataset + LLM-as-judge faithfulness (3× majority vote), recall@K, OCR CER/WER via `jiwer`. `npm run eval` produces JSON + Markdown. |
| **Design system** | shadcn-style primitives on Radix + CVA, Tailwind v4 CSS variables, dark-mode class strategy, `motion/react` route transitions, `axe-core` WCAG AA gate. |
| **Production-ready** | Multi-stage Dockerfiles, Compose profiles (`default`, `ollama`, `prod-local`, `prod`), Caddy reverse proxy with auto-HTTPS, and GitHub Actions CI with GHCR build/push. |

---

## Architecture

```
                        ┌────────────────────┐
                        │  Ollama (local)    │
                        │  qwen2.5:7b-instruct
                        │  nomic-embed-text  │
                        └────────▲───────────┘
                                 │
 ┌──────────┐    REST/SSE   ┌────┴─────┐    BullMQ    ┌───────────────┐
 │ Frontend │──────────────▶│ Backend  │─────────────▶│ Ingest worker │
 │ React 19 │◀──────────────│ Express  │              │ OCR worker    │
 │ Vite     │     WS        │ Prisma   │              └───────┬───────┘
 └──────────┘               └────┬─────┘                      │
                                 │                            │
                      ┌──────────┴──────────┐      HTTP       ▼
                      ▼                     ▼         ┌───────────────┐
               ┌─────────────┐      ┌───────────────┐ │ ai-sidecar    │
               │ Postgres 15 │      │ Redis 7       │ │ FastAPI       │
               │ + pgvector  │      │ + BullMQ      │ │ TrOCR/Nougat/ │
               └─────────────┘      └───────────────┘ │ Unstructured  │
                                                     └───────────────┘
```

---

## Quick start (5 minutes, local)

Prerequisites: **Docker Desktop**, **Git**, and ~8 GB free disk for Ollama models.

```bash
git clone <your fork> cognitive-copilot
cd cognitive-copilot
cp .env.example .env
# Edit .env: set AUTH_SECRET, optionally DOMAIN for prod profile.

# Infra + Ollama, models pre-pulled, no app containers:
docker compose --profile ollama up -d

# Backend (runs migrations + dev server with hot reload):
cd backend
npm install
npx prisma migrate dev
npm run db:seed
npm run dev

# Frontend in another terminal:
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and register an account. Upload a PDF material to a course — ingestion runs as a BullMQ job; you'll see the progress in your instructor dashboard.

> **Tip.** Using the `accurate` OCR path downloads ~3 GB of TrOCR/Nougat weights on first request. Pre-cache them by invoking any accurate OCR endpoint once.

---

## Full production demo (one command)

```bash
docker compose --profile prod-local up -d --build
```

This spins up Postgres + pgvector, Redis, Ollama (with models), the FastAPI AI sidecar, the backend, the built frontend, and a Caddy reverse proxy with a self-signed TLS certificate. The tutor is reachable at https://localhost/.

Swap to `--profile prod` with `DOMAIN=your.host` for Let's Encrypt auto-HTTPS.

---

## Running the evaluation harness

The eval runner takes the golden RAG fixtures in `backend/src/eval/fixtures/` and scores:

- **Faithfulness** — LLM-as-judge, 3× majority vote.
- **Context precision** — how many retrieved chunks actually support the answer.
- **Recall@K** — does the gold source appear in the top-K retrieval?
- **Answer relevance** — semantic similarity between expected and generated answer.

```bash
cd backend
# Fast smoke set (first 3 fixtures, CI-gated):
npm run eval:smoke
# Full run with markdown + JSON report in backend/eval-output/:
npm run eval
```

OCR CER/WER runs automatically against `backend/src/eval/fixtures/golden-ocr/` using the sidecar's `/eval/wer` endpoint (with a Levenshtein fallback if the sidecar is down).

---

## Observability

- **Structured logs.** Pino JSON → stdout. Use `pino-pretty` in dev (wired automatically by `NODE_ENV=development`).
- **Prometheus metrics.** `GET /metrics` (guarded by `X-Metrics-Key: $METRICS_KEY`). Exposes `llm_call_duration_seconds`, `llm_tokens_total`, `llm_errors_total`, `rag_retrieval_hit_rate`, `ingest_job_duration_seconds`, and more.
- **Instructor dashboard.** `/analytics/evaluation` in the UI — real-time aggregates of every Ollama call plus your per-topic Beta-posterior mastery with 95 % CIs.
- **Grafana dashboard JSON.** Optional, in `ops/grafana/dashboard.json`.

---

## Design system

- **Tokens.** CSS variables in `frontend/src/index.css`, mapped to Tailwind v4 via `@theme`.
- **Dark mode.** `html.dark` class toggled from `useThemeStore`; respects `prefers-color-scheme` on first visit.
- **Primitives.** shadcn-style Radix + CVA components under `frontend/src/components/ui/`. No external UI library is installed as a runtime dep.
- **Motion.** `motion/react` route transitions behind `useReducedMotion`.
- **Accessibility.** `@axe-core/cli` runs in CI against the landing page and login. Target: WCAG AA, 0 serious/critical violations.

---

## Repository layout

```
backend/
  src/
    config/         # env, db, socket, swagger
    controllers/    # auth, courses, ai-tutor, ask-course, evaluation…
    services/
      agent/        # prompt hierarchy, strategy selector, ReAct loop, tools
      rag/          # chunker, embedding, retriever, answer
      observability/# llm-logger, metrics, logger
      ollama.service.ts  # chatCompletion, chatCompletionStructured, embed
      ocr.service.ts     # fast (Tesseract) / accurate (sidecar) dispatch
    jobs/           # BullMQ workers: ingest, ocr, queues
    eval/           # runner, metrics, golden fixtures
  prisma/           # schema, migrations (incl. pgvector, LlmCall, Beta-posterior)

frontend/
  src/
    components/
      ui/                # shadcn-style primitives
      ai-tutor/          # ChatPane, AskCoursePane, QuizPane, MaterialPreviewPane,
                         # ModeSwitcher, CitationChip, StrategyBadge, TutorTrace
      layout/            # Sidebar, Header, AppLayout
    pages/
      landing/LandingPage.tsx
      analytics/InstructorEvalPage.tsx
      ai-tutor/AITutorPage.tsx
    stores/theme.store.ts
    lib/onboarding-tour.ts

ai-sidecar/
  Dockerfile
  requirements.txt
  app/main.py        # /ocr/handwriting, /ocr/academic-pdf, /ocr/layout,
                     # /eval/wer, /eval/keyword-overlap

ops/
  caddy/Caddyfile
  grafana/dashboard.json   # optional

study/
  protocol.md
  consent.md

scripts/
  analyze_study.py

report/
  chapters/{1..7}.tex
  references.bib
```

---

## Acknowledgements

Built as the CSE 3200 capstone project at Khulna University of Engineering & Technology. With thanks to our supervisor Prof. Md. Nazirul Hasan Shawon for the substantive guidance on the pedagogical-strategy design and the evaluation methodology.

Models: **Qwen2.5-7B-Instruct** (Alibaba DAMO), **Nomic-Embed-Text-v1** (Nomic), **TrOCR** (Microsoft), **Nougat** (Meta AI).

Licence: MIT — see [`LICENSE`](LICENSE).
