import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const llmCallDuration = new Histogram({
  name: 'llm_call_duration_seconds',
  help: 'Duration of LLM calls in seconds, by route and status',
  labelNames: ['route', 'model', 'status'] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 60],
  registers: [registry],
});

export const llmTokensTotal = new Counter({
  name: 'llm_tokens_total',
  help: 'Total LLM tokens consumed, by direction and route',
  labelNames: ['direction', 'route', 'model'] as const,
  registers: [registry],
});

export const llmCostUsdTotal = new Counter({
  name: 'llm_cost_usd_total',
  help: 'Total estimated LLM cost in USD, by route and model',
  labelNames: ['route', 'model'] as const,
  registers: [registry],
});

export const llmErrorsTotal = new Counter({
  name: 'llm_errors_total',
  help: 'LLM errors by route, model, and kind',
  labelNames: ['route', 'model', 'kind'] as const,
  registers: [registry],
});

export const ragRetrievalHitRate = new Gauge({
  name: 'rag_retrieval_hit_rate',
  help: 'Fraction of RAG queries that returned at least one chunk above similarity threshold',
  labelNames: ['course'] as const,
  registers: [registry],
});

export const ragChunksReturned = new Histogram({
  name: 'rag_chunks_returned',
  help: 'Number of chunks returned per RAG query after fusion',
  labelNames: ['route'] as const,
  buckets: [0, 1, 2, 4, 8, 16, 32],
  registers: [registry],
});

export const ingestJobDuration = new Histogram({
  name: 'ingest_job_duration_seconds',
  help: 'Duration of material ingestion jobs in seconds',
  labelNames: ['stage', 'status'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [registry],
});

export const ocrJobDuration = new Histogram({
  name: 'ocr_job_duration_seconds',
  help: 'Duration of OCR jobs in seconds',
  labelNames: ['quality', 'engine', 'status'] as const,
  buckets: [0.5, 1, 2, 5, 10, 20, 45, 90, 180],
  registers: [registry],
});

/**
 * Express handler for /metrics — guarded by the X-Metrics-Key header so scraping
 * credentials stay out of public reach (see env.METRICS_KEY).
 */
export function metricsHandler() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const provided = req.header('x-metrics-key');
    if (!provided || provided !== env.METRICS_KEY) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      res.set('Content-Type', registry.contentType);
      res.send(await registry.metrics());
    } catch (err) {
      next(err);
    }
  };
}
