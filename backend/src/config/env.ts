import dotenv from 'dotenv';
import path from 'path';

const backendRoot = path.resolve(__dirname, '../..');

// Preserve NODE_ENV if already set (e.g. by test runner)
const savedNodeEnv = process.env.NODE_ENV;

// Load root .env first, then backend .env (backend values take priority)
dotenv.config({ path: path.resolve(backendRoot, '../.env') });
dotenv.config({ path: path.resolve(backendRoot, '.env'), override: true });

// Restore NODE_ENV if it was set before dotenv
if (savedNodeEnv) {
  process.env.NODE_ENV = savedNodeEnv;
}

import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  AUTH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES: z.string().default('15m'),
  JWT_REFRESH_EXPIRES: z.string().default('7d'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default('cognitive-copilot'),
  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  // Default chat model; qwen2.5:7b-instruct has strong JSON-schema compliance.
  OLLAMA_MODEL: z.string().default('qwen2.5:7b-instruct'),
  // Embedding model for RAG. nomic-embed-text is 768-dim, fast, Ollama-native.
  OLLAMA_EMBEDDING_MODEL: z.string().default('nomic-embed-text'),
  OLLAMA_EMBEDDING_DIM: z.coerce.number().default(768),
  // Python sidecar for handwriting / Nougat / layout OCR + eval scoring.
  AI_SIDECAR_URL: z.string().default('http://localhost:8000'),
  // Guard the /metrics endpoint — header X-Metrics-Key must match.
  METRICS_KEY: z.string().default('change-me'),
  // Feature flags (toggle without redeploy via env).
  ENABLE_CROSS_ENCODER: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  ENABLE_AGENT_TOOLS: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  // Socratic tutor behaviour.
  AGENT_MAX_ITERATIONS: z.coerce.number().default(5),
  AGENT_WALL_CLOCK_MS: z.coerce.number().default(12_000),
  // RAG tuning.
  RAG_TOP_K: z.coerce.number().default(8),
  RAG_CHUNK_SIZE: z.coerce.number().default(800),
  RAG_CHUNK_OVERLAP: z.coerce.number().default(150),
  // Observability sampling (1.0 = log all prompts; lower in prod).
  LLM_LOG_SAMPLING_RATE: z.coerce.number().default(1.0),
  PORT: z.coerce.number().default(3001),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('noreply@cognitivecopilot.com'),
});

export const env = envSchema.parse(process.env);
