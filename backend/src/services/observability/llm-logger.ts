import { randomUUID } from 'crypto';
import type { LlmCallStatus, TutorStrategy } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { logger } from './logger.js';
import { llmCallDuration, llmErrorsTotal, llmTokensTotal } from './metrics.js';

export interface LlmLogContext {
  userId?: string | null;
  model?: string;
  strategy?: TutorStrategy | null;
  toolName?: string | null;
  parentCallId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface LlmLogResult<T = string> {
  value: T;
  completion: string;
  prompt: unknown;
  toolCalls?: unknown;
  promptTokens?: number;
  completionTokens?: number;
}

export type LlmFn<T> = (callId: string) => Promise<LlmLogResult<T>>;

/**
 * Sampling gate — cheap uniform [0,1) check, defaults to 1.0 (log everything).
 * Errors are always logged regardless of sampling.
 */
function shouldSample(): boolean {
  const rate = env.LLM_LOG_SAMPLING_RATE;
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  return Math.random() < rate;
}

/**
 * Wrap any LLM-producing async function so every call is measured, logged to
 * Prometheus, and persisted to the LlmCall table. Returns the caller's value;
 * the DB write is fire-and-forget so it never blocks the user-facing response.
 *
 * The wrapped function receives the pre-allocated callId so it can set
 * parentCallId on any downstream calls it dispatches (agent ReAct chains).
 */
export async function withLogging<T>(
  route: string,
  fn: LlmFn<T>,
  ctx: LlmLogContext = {}
): Promise<T> {
  const callId = randomUUID();
  const model = ctx.model ?? env.OLLAMA_MODEL;
  const started = process.hrtime.bigint();
  let status: LlmCallStatus = 'OK';
  let errorMsg: string | undefined;
  let result: LlmLogResult<T> | undefined;

  try {
    result = await fn(callId);
    return result.value;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = /timeout|timed out|AbortError/i.test(message);
    status = isTimeout ? 'TIMEOUT' : 'ERROR';
    errorMsg = message;
    llmErrorsTotal.inc({ route, model, kind: isTimeout ? 'timeout' : 'error' });
    throw err;
  } finally {
    const latencyMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
    llmCallDuration.observe({ route, model, status: status.toLowerCase() }, latencyMs / 1000);

    const promptTokens = result?.promptTokens ?? 0;
    const completionTokens = result?.completionTokens ?? 0;
    if (promptTokens) llmTokensTotal.inc({ direction: 'prompt', route, model }, promptTokens);
    if (completionTokens)
      llmTokensTotal.inc({ direction: 'completion', route, model }, completionTokens);

    const persist = status !== 'OK' || shouldSample();
    if (persist) {
      prisma.llmCall
        .create({
          data: {
            id: callId,
            userId: ctx.userId ?? null,
            route,
            model,
            strategy: ctx.strategy ?? null,
            toolName: ctx.toolName ?? null,
            prompt: (result?.prompt ?? {}) as object,
            completion: result?.completion ?? '',
            toolCalls: (result?.toolCalls as object | undefined) ?? undefined,
            promptTokens,
            completionTokens,
            latencyMs,
            costUsd: 0,
            parentCallId: ctx.parentCallId ?? null,
            status,
            errorMsg,
            metadata: (ctx.metadata as object | undefined) ?? undefined,
          },
        })
        .catch((persistErr) => {
          logger.error({ err: persistErr, route, callId }, 'llm-call persist failed');
        });
    }

    logger.debug(
      { route, callId, model, latencyMs, status, promptTokens, completionTokens },
      'llm.call'
    );
  }
}

/**
 * Estimate token count from text when the backend does not report usage.
 * Rough heuristic: 1 token ≈ 4 chars for English. Good enough for Prom metrics.
 */
export function approxTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
