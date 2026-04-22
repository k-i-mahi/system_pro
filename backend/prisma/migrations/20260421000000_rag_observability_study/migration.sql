-- Cognitive Copilot — RAG + Observability + Study migration
-- Extends the existing schema with:
--   1. pgvector extension for embeddings
--   2. Embedding table with vector(768) + tsvector for hybrid retrieval
--   3. LlmCall table for LLM observability
--   4. QuestionBank table for adaptive difficulty
--   5. StudySession table for user-study telemetry
--   6. TopicProgress.alpha/beta for Bayesian Beta posterior
--   7. Material.hasEmbeddings/ingestStatus/ocrQuality/chunkCount/ingestError
--   8. New enums: OcrQuality, IngestStatus, LlmCallStatus, TutorStrategy

-- ── 0. Extensions ─────────────────────────────────────────
-- NOTE: Prisma wraps migrations in its own transaction; do not use BEGIN/COMMIT here.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- Useful for fuzzy text ops downstream.

-- ── 1. Enums ──────────────────────────────────────────────
CREATE TYPE "OcrQuality" AS ENUM ('FAST', 'ACCURATE');
CREATE TYPE "IngestStatus" AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');
CREATE TYPE "LlmCallStatus" AS ENUM ('OK', 'ERROR', 'TIMEOUT');
CREATE TYPE "TutorStrategy" AS ENUM (
  'EXPLAIN',
  'SOCRATIC',
  'HINT_LADDER',
  'WORKED_EXAMPLE',
  'MISCONCEPTION_PROBE'
);

-- ── 2. Extend existing tables ─────────────────────────────

-- Material: ingestion state + OCR quality preference.
ALTER TABLE "Material"
  ADD COLUMN "hasEmbeddings" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "ingestStatus" "IngestStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "ingestError" TEXT,
  ADD COLUMN "chunkCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ocrQuality" "OcrQuality" NOT NULL DEFAULT 'FAST';

-- TopicProgress: Bayesian Beta posterior (Beta(1,1) prior = uniform).
ALTER TABLE "TopicProgress"
  ADD COLUMN "alpha" DOUBLE PRECISION NOT NULL DEFAULT 1,
  ADD COLUMN "beta"  DOUBLE PRECISION NOT NULL DEFAULT 1;

-- ── 3. Embedding table ────────────────────────────────────
CREATE TABLE "Embedding" (
  "id"         TEXT PRIMARY KEY,
  "materialId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "content"    TEXT NOT NULL,
  "page"       INTEGER,
  "heading"    TEXT,
  "tokenCount" INTEGER NOT NULL DEFAULT 0,
  "embedding"  vector(768),
  "tsv"        tsvector,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Embedding_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE
);

CREATE INDEX "Embedding_materialId_idx" ON "Embedding"("materialId");
CREATE INDEX "Embedding_materialId_chunkIndex_idx" ON "Embedding"("materialId", "chunkIndex");

-- HNSW index for cosine similarity (pgvector >= 0.5).
-- Parameters tuned for ~100k chunks on commodity hardware.
CREATE INDEX "Embedding_embedding_hnsw_idx"
  ON "Embedding" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- GIN index for BM25 via tsvector.
CREATE INDEX "Embedding_tsv_gin_idx" ON "Embedding" USING gin ("tsv");

-- Auto-update tsvector on insert / update.
CREATE FUNCTION embedding_tsv_trigger() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER embedding_tsv_update
  BEFORE INSERT OR UPDATE OF content
  ON "Embedding"
  FOR EACH ROW
  EXECUTE FUNCTION embedding_tsv_trigger();

-- ── 4. LlmCall table ──────────────────────────────────────
CREATE TABLE "LlmCall" (
  "id"               TEXT PRIMARY KEY,
  "userId"           TEXT,
  "route"            TEXT NOT NULL,
  "model"            TEXT NOT NULL,
  "strategy"         "TutorStrategy",
  "toolName"         TEXT,
  "prompt"           JSONB NOT NULL,
  "completion"       TEXT NOT NULL,
  "toolCalls"        JSONB,
  "promptTokens"     INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "latencyMs"        INTEGER NOT NULL DEFAULT 0,
  "costUsd"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "parentCallId"     TEXT,
  "status"           "LlmCallStatus" NOT NULL DEFAULT 'OK',
  "errorMsg"         TEXT,
  "metadata"         JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LlmCall_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL,
  CONSTRAINT "LlmCall_parentCallId_fkey"
    FOREIGN KEY ("parentCallId") REFERENCES "LlmCall"("id") ON DELETE SET NULL
);

CREATE INDEX "LlmCall_userId_createdAt_idx" ON "LlmCall"("userId", "createdAt" DESC);
CREATE INDEX "LlmCall_route_createdAt_idx"  ON "LlmCall"("route", "createdAt" DESC);
CREATE INDEX "LlmCall_status_createdAt_idx" ON "LlmCall"("status", "createdAt" DESC);

-- ── 5. QuestionBank ───────────────────────────────────────
CREATE TABLE "QuestionBank" (
  "id"          TEXT PRIMARY KEY,
  "topicId"     TEXT NOT NULL,
  "question"    TEXT NOT NULL,
  "options"     JSONB NOT NULL,
  "correct"     TEXT NOT NULL,
  "explanation" TEXT,
  "difficulty"  INTEGER NOT NULL DEFAULT 3,
  "source"      TEXT NOT NULL DEFAULT 'llm',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "QuestionBank_topicId_difficulty_idx"
  ON "QuestionBank"("topicId", "difficulty");

-- ── 6. StudySession ───────────────────────────────────────
CREATE TABLE "StudySession" (
  "id"          TEXT PRIMARY KEY,
  "userId"      TEXT NOT NULL,
  "cohort"      TEXT NOT NULL DEFAULT 'pilot',
  "preTest"     JSONB,
  "postTest"    JSONB,
  "susScore"    DOUBLE PRECISION,
  "npsScore"    INTEGER,
  "notes"       TEXT,
  "startedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "StudySession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "StudySession_userId_cohort_key"
  ON "StudySession"("userId", "cohort");

