# Cognitive Copilot: An AI-Powered Academic Learning Management System with Local LLM Integration

## Research Contribution Paper

**Authors:** [Team Members]  
**Institution:** [University Name]  
**Date:** April 2026

---

## Abstract

This paper presents **Cognitive Copilot**, a full-stack, AI-integrated Learning Management System (LMS) designed for university-level academic environments. The platform uniquely combines **locally-hosted Large Language Model (LLM) inference** via Ollama with traditional LMS capabilities—course management, attendance tracking, community discussions, and analytics—to deliver a **privacy-preserving, cost-effective, adaptive tutoring system**. Key contributions include: (1) a real-time SSE-streamed AI tutor powered by local LLM inference, (2) dynamic competency modeling through AI-generated assessments, (3) OCR-based schedule digitization from physical timetable images, and (4) a hybrid real-time notification architecture using Socket.IO and BullMQ. The system comprises 14 database models, 9 frontend modules, and comprehensive test coverage (130 automated tests), demonstrating production-readiness for institutional deployment.

**Keywords:** Learning Management System, Large Language Model, Adaptive Tutoring, Local AI Inference, Privacy-Preserving Education Technology, OCR

---

## 1. Introduction

### 1.1 Problem Statement

Modern educational institutions increasingly rely on Learning Management Systems to manage academic workflows. However, existing solutions face several critical limitations:

1. **Cloud AI Dependency:** Platforms using OpenAI, Google, or similar APIs incur per-request costs, raise data privacy concerns, and require internet connectivity—unsuitable for institutions in resource-constrained or data-sensitive environments.
2. **Passive Learning Models:** Most LMS platforms function as content repositories without intelligent tutoring, adaptive assessment, or personalized learning pathways.
3. **Fragmented Workflows:** Students juggle between physical timetables, separate discussion forums, and disconnected analytics dashboards, increasing cognitive overhead.
4. **Limited Real-Time Interaction:** Traditional LMS platforms rely on polling-based notifications, missing the immediacy required for time-sensitive academic reminders.

### 1.2 Proposed Solution

Cognitive Copilot addresses these gaps through a unified platform that integrates:

- **Local LLM-powered tutoring** (Ollama + Llama 3.2) for zero-cost, privacy-preserving AI assistance
- **Dynamic competency modeling** where AI-generated quizzes directly update student expertise levels
- **OCR-driven schedule extraction** from physical timetable images
- **Real-time event-driven architecture** using WebSockets and async job queues

---

## 2. System Architecture

### 2.1 Technology Stack

| Layer | Technology | Justification |
|---|---|---|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS 4 | Modern SPA framework with type safety and fast HMR |
| Backend | Node.js, Express 4, TypeScript | Non-blocking I/O suitable for SSE streaming and WebSocket connections |
| Database | PostgreSQL 15 (Prisma ORM) | Relational integrity for academic data with type-safe queries |
| Cache/Queue | Redis 7 (ioredis + BullMQ) | Token blacklisting, session caching, and async job processing |
| AI Engine | Ollama (Llama 3.2) | Local LLM inference—no API costs, full data sovereignty |
| OCR | Tesseract.js 5 | Client-side/server-side OCR for timetable image processing |
| Real-time | Socket.IO 4 | Bidirectional WebSocket communication for live notifications |
| File Storage | Cloudinary | CDN-backed material hosting with image transformations |
| Infrastructure | Docker Compose | Reproducible deployment of PostgreSQL and Redis |

### 2.2 Architectural Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React 19)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ AI Tutor │ │ Courses  │ │Analytics │ │Community │   │
│  │ (SSE)    │ │ Module   │ │Dashboard │ │ Threads  │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │
│       │ Zustand (Auth Store) + React Query (Server State)│
└───────┼────────────┼────────────┼────────────┼──────────┘
        │   REST API │  (Vite    │  Proxy)    │
        ▼            ▼           ▼            ▼
┌─────────────────────────────────────────────────────────┐
│                  Backend (Express + TS)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │   Auth   │ │  Routes  │ │ Socket.IO│ │ BullMQ   │   │
│  │Middleware│ │Controllers││  Server  │ │ Workers  │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘   │
│       │   Prisma ORM│           │             │         │
└───────┼────────────┼───────────┼─────────────┼──────────┘
        ▼            ▼           ▼             ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│PostgreSQL│  │  Redis 7  │  │  Ollama  │  │Cloudinary│
│   15     │  │(Cache/MQ) │  │(Local AI)│  │  (CDN)   │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

### 2.3 Database Schema

The system uses **14 interconnected models** managed through Prisma ORM:

| Model | Purpose | Key Fields |
|---|---|---|
| `User` | Account management | name, email, role, i18n preferences, notification toggles |
| `Course` | Course catalog | code, name, category, level, credits, rating |
| `Enrollment` | Student-course binding | CT scores (1-3), lab score, progress tracking |
| `ScheduleSlot` | Timetable entries | day, start/end time, type (CLASS/LAB), room |
| `Topic` | Course content units | title, week number, session date, status |
| `Material` | Learning resources | type (PDF/VIDEO/IMAGE/LINK/NOTE), Cloudinary URL |
| `TopicProgress` | Competency tracking | expertiseLevel (0.0-1.0), studyMinutes, examScore |
| `AttendanceRecord` | Attendance tracking | date, present/absent per schedule slot |
| `ExamAttempt` | Quiz results | AI-generated questions (JSON), score, time taken |
| `Thread` / `ThreadPost` / `ThreadLike` | Community discussions | course-scoped threads, replies, likes |
| `Notification` | Multi-type alerts | 9 types, metadata (JSON), read status |
| `Message` | Direct messaging | sender, receiver, file attachments |
| `RoutineScan` | OCR processing records | extracted text, parsed codes, processing status |

---

## 3. Key Technical Contributions

### 3.1 Local LLM-Powered Adaptive Tutoring

**Novelty:** Unlike cloud-dependent tutoring systems (e.g., Khan Academy's Khanmigo, Duolingo Max), Cognitive Copilot runs LLM inference **entirely on local infrastructure** via Ollama, eliminating per-request API costs and ensuring complete data sovereignty.

**Architecture:**

```
Student → Frontend (SSE Reader) → Backend (Express SSE) → Ollama API
                                                            │
                              Context Injection ◄───────────┘
                              (Course + Topic + Mode)
```

**Implementation Details:**
- **Server-Sent Events (SSE):** The AI chat endpoint streams responses token-by-token using `text/event-stream`, providing real-time typing feedback identical to commercial AI chat products.
- **Context-Aware Prompting:** Each AI request is enriched with course name, topic title, and interaction mode (`explain`, `quiz`, or open `chat`), enabling pedagogically relevant responses.
- **Graceful Degradation:** When Ollama is unavailable, the system detects `ECONNREFUSED` errors and returns a user-friendly fallback message rather than crashing.
- **Study Time Tracking:** Each AI interaction automatically increments `studyMinutes` in `TopicProgress`, creating a passive learning analytics signal.

### 3.2 Dynamic Competency Modeling via AI-Generated Assessment

**Novelty:** The system implements a **closed-loop feedback cycle** between LLM quiz generation, student assessment, and expertise modeling:

```
LLM generates quiz → Student answers → System scores →
    Expertise level adjusted → Next quiz difficulty adapted
```

**Expertise Algorithm:**
```typescript
// Score ≥ 70%: Increase expertise by 0.1 (capped at 1.0)
// Score < 50%: Decrease expertise by 0.05 (floored at 0.0)
// 50-69%: No change (consolidation zone)
```

This creates a **continuous competency metric** (0.0 to 1.0) per student per topic, enabling:
- Personalized study recommendations
- Visual expertise heatmaps in analytics
- Data-driven academic support triggers

### 3.3 OCR-Driven Schedule Digitization

**Novelty:** Addresses the real-world problem of students receiving **physical paper timetables** by providing automated digitization:

1. Student uploads a photo of their university timetable
2. **Tesseract.js** performs OCR text extraction server-side
3. **Regex-based course code extraction** (`/[A-Z]{2,4}\s?\d{3,4}/g`) identifies course identifiers
4. Codes are deduplicated, normalized, and matched against the course database
5. Schedule slots are automatically created in the student's routine

This bridges the **physical-to-digital gap** in academic workflows—a common pain point in universities that still distribute printed timetables.

### 3.4 Hybrid Real-Time Notification Architecture

**Novelty:** Combines two complementary delivery mechanisms for optimal notification handling:

| Mechanism | Use Case | Characteristics |
|---|---|---|
| **Socket.IO** | Immediate push | Zero latency for online users, JWT-authenticated rooms |
| **BullMQ + Redis** | Async processing | Reliable delivery with retry (3 attempts, exponential backoff), concurrency control (5 workers) |

**9 Notification Types:**
- `CLASS_REMINDER`, `LAB_REMINDER`, `EXAM_REMINDER` — Time-sensitive academic alerts
- `TOPIC_SUGGESTION` — AI-driven study recommendations
- `MATERIAL_UPLOAD` — New content availability
- `NEW_COURSE`, `MY_COURSE` — Course updates
- `MESSAGE` — Direct communication
- `SYSTEM` — Platform announcements

Each user can toggle notification preferences per category, respecting **cognitive load management** principles from educational psychology.

---

## 4. Security Architecture

The platform implements defense-in-depth security suitable for educational institution deployment:

### 4.1 Authentication & Authorization
- **JWT dual-token architecture:** Short-lived access tokens (15 min) + long-lived refresh tokens (7 days)
- **Token rotation:** Each refresh generates new access AND refresh tokens, preventing replay attacks
- **Redis-backed blacklisting:** Logged-out tokens are immediately invalidated via `bl:{token}` keys with TTL
- **Role-based access control:** Three roles (STUDENT, MENTOR, ADMIN) with middleware enforcement

### 4.2 Input Validation & Rate Limiting
- **Zod schema validation** on all API inputs—type-safe request validation at the middleware layer
- **Tiered rate limiting:**
  - Authentication endpoints: 10 requests/minute (brute-force protection)
  - AI endpoints: 30 requests/minute (resource protection)
  - File uploads: 20 requests/hour (storage protection)

### 4.3 Infrastructure Security
- **Helmet.js** for HTTP security headers (CSP, HSTS, X-Frame-Options)
- **CORS** with configurable origin whitelist
- **Environment validation** at startup via Zod (minimum 16-character `AUTH_SECRET` enforced)
- **Parameterized queries** via Prisma ORM (SQL injection prevention)

---

## 5. Frontend Architecture & User Experience

### 5.1 State Management Strategy

| State Type | Technology | Scope |
|---|---|---|
| Auth state | Zustand + `persist` | Cross-session (localStorage) |
| Server state | TanStack React Query | Cache with invalidation |
| UI state | Zustand (non-persisted) | Session-scoped |

### 5.2 Module Overview

| Module | Description | Key UX Features |
|---|---|---|
| **AI Tutor** | Interactive chat with course/topic scoping | SSE streaming, quick action buttons, markdown rendering |
| **Routine** | Weekly timetable grid | Drag-drop, OCR upload via react-dropzone |
| **Courses** | Course catalog + detail view | Enrollment, topic list, material viewer |
| **Community** | Discussion forum | Thread CRUD, likes, course-scoped filtering |
| **Analytics** | Multi-chart dashboard | Bar charts (expertise), pie charts (attendance), line charts (exam trends) |
| **Notifications** | Real-time alert center | Type icons, mark-all-read, delete with optimistic updates |
| **Settings** | User preferences | Language, timezone, date format, password change, notification toggles |
| **Profile** | User profile management | Avatar upload, bio editing |

### 5.3 Design System
- **Custom Tailwind CSS 4 theme** with CSS variables for consistent branding
- **Lucide React** icon library (lightweight, tree-shakeable)
- **Recharts** for data visualization (accessible, responsive)
- **KaTeX** for mathematical notation rendering in AI tutor responses

---

## 6. Testing & Quality Assurance

### 6.1 Test Coverage Summary

| Category | Framework | Tests | Status |
|---|---|---|---|
| Backend API Integration | Vitest + Supertest | 42 | ✅ All Passing |
| Frontend Unit/Component | Vitest + Testing Library | 88 | ✅ All Passing |
| **Total** | | **130** | **✅ All Passing** |

### 6.2 Backend Test Suites

| Suite | Tests | Coverage |
|---|---|---|
| Authentication | 10 | Register, login, token refresh, logout, blacklisting, input validation |
| Courses | 4 | List, enrolled courses, detail, 404 handling |
| Community | 10 | CRUD threads/posts, likes, filtering, ownership deletion |
| Settings | 5 | Get, update general/password/notifications |
| Profile | 4 | Get, update, validation, auth guard |
| Notifications | 4 | List, unread count, mark-read, auth guard |
| Analytics | 3 | Overview, course-specific, auth guard |
| Routine | 1 | Schedule slot retrieval |
| Health Check | 1 | System health endpoint |

### 6.3 Frontend Test Suites

- **Store tests:** Auth store (5 tests), UI store (2 tests)
- **Component tests:** AppLayout (1), Header (5), Sidebar (4)
- **Page tests:** All 10 page modules tested (AI Tutor: 7, Analytics: 5, Community: 7, Course Detail: 8, Courses: 8, Notifications: 6, Profile: 10, Routine: 7, Settings: 8)
- **Auth flow tests:** Login page (3), Register page (2)

---

## 7. Comparison with Existing Systems

| Feature | Moodle | Canvas | Google Classroom | **Cognitive Copilot** |
|---|---|---|---|---|
| AI Tutoring | ❌ | ❌ | ❌ | ✅ Local LLM (Ollama) |
| Privacy-Preserving AI | N/A | N/A | ❌ (Cloud) | ✅ On-premise inference |
| Real-time Notifications | ❌ (Polling) | Partial | ❌ | ✅ Socket.IO + BullMQ |
| OCR Schedule Import | ❌ | ❌ | ❌ | ✅ Tesseract.js |
| Dynamic Competency Model | ❌ | Partial | ❌ | ✅ AI-driven expertise tracking |
| Adaptive Assessment | ❌ | ❌ | ❌ | ✅ LLM-generated quizzes |
| Community Integration | Plugin | Plugin | ❌ | ✅ Course-scoped threads |
| Modern Tech Stack | PHP | Ruby | Proprietary | ✅ React + TypeScript + Node.js |
| Self-Hosted | ✅ | ❌ | ❌ | ✅ Docker Compose |

---

## 8. Deployment & Reproducibility

### 8.1 Prerequisites
- Node.js 18+, Docker, Ollama (with `llama3.2` model)

### 8.2 Setup Commands
```bash
# Start infrastructure
docker compose up -d          # PostgreSQL + Redis

# Backend
cd backend
npm install
npx prisma migrate dev        # Apply schema migrations
npx prisma db seed             # Seed test data
npm run dev                    # Start on port 3001

# Frontend
cd frontend
npm install
npm run dev                    # Start on port 5173 (proxies /api → :3001)

# AI Service (optional)
ollama serve                   # Start Ollama on port 11434
ollama pull llama3.2           # Download AI model
```

### 8.3 Test Execution
```bash
cd backend && npm test         # 42 integration tests
cd frontend && npm test        # 88 component/unit tests
```

---

## 9. Future Work

1. **Federated Learning Integration:** The system architecture already includes a placeholder FL orchestrator service (`copilot-fl`) for privacy-preserving model training across institutions.
2. **Learning Path Optimization:** Using TopicProgress data to build prerequisite graphs and recommend optimal study sequences.
3. **Multi-Modal AI Tutoring:** Extending the AI tutor to process uploaded images/diagrams using vision-language models.
4. **Peer Assessment Module:** Leveraging the community thread infrastructure for structured peer review workflows.
5. **Accessibility Compliance:** WCAG 2.1 AA compliance audit and screen reader optimization.

---

## 10. Conclusion

Cognitive Copilot demonstrates that a **privacy-preserving, AI-integrated LMS** can be built using modern open-source technologies without dependence on commercial cloud AI APIs. The platform's key contributions—local LLM tutoring, dynamic competency modeling, OCR-based schedule digitization, and hybrid real-time notifications—address real gaps in existing educational technology. With 130 automated tests, Docker-based deployment, and a modular architecture, the system is ready for institutional pilot deployment and further academic research.

---

## References

1. Ollama. "Run Llama 3, Mistral, and other large language models locally." https://ollama.com
2. Meta AI. "Llama 3.2: Lightweight models for edge and mobile devices." 2024.
3. Tesseract OCR. "Tesseract.js - Pure JavaScript OCR for 100+ Languages." https://tesseract.projectnaptha.com
4. Bull. "BullMQ - Premium Message Queue for Node.js based on Redis." https://bullmq.io
5. Socket.IO. "Bidirectional and low-latency communication for every platform." https://socket.io
6. Prisma. "Next-generation Node.js and TypeScript ORM." https://www.prisma.io
7. Anderson, T. (2003). "Getting the Mix Right Again: An Updated and Theoretical Rationale for Interaction." *International Review of Research in Open and Distributed Learning*, 4(2).
8. Bloom, B.S. (1984). "The 2 Sigma Problem: The Search for Methods of Group Instruction as Effective as One-to-One Tutoring." *Educational Researcher*, 13(6), 4-16.
9. VanLehn, K. (2011). "The Relative Effectiveness of Human Tutoring, Intelligent Tutoring Systems, and Other Tutoring Systems." *Educational Psychologist*, 46(4), 197-221.

---

*© 2026 Cognitive Copilot Team. All rights reserved.*
