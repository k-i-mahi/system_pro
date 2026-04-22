import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import * as resp from '../utils/response.js';
import { answerWithCitations } from '../services/rag/answer.service.js';
import { logger } from '../services/observability/logger.js';
import { prisma } from '../config/database.js';

/**
 * POST /api/ai/ask-course
 * Body: { question, courseId?, topicId?, materialIds?[], stream? }
 *
 * When `stream` is true, responds with Server-Sent Events:
 *   event: token  data: "<partial text>"
 *   event: citations  data: { citations: [...] }
 *   event: done
 *
 * Otherwise returns the full answer + citations as JSON.
 */
export async function askCourse(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { question, courseId, topicId, materialIds, stream } = req.body as {
      question: string;
      courseId?: string;
      topicId?: string;
      materialIds?: string[];
      stream?: boolean;
    };

    if (!question || typeof question !== 'string' || question.trim().length < 3) {
      return resp.error(res, 400, 'BAD_QUESTION', 'Please provide a question of at least 3 characters');
    }

    const scope = {
      courseId,
      topicId,
      materialIds,
      userId: req.userId,
    };

    if (courseId) {
      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } });
      if (!course) return resp.error(res, 404, 'NOT_FOUND', 'Course not found');
    }

    if (stream) {
      return streamAnswer(req, res, question, scope);
    }

    const result = await answerWithCitations(question, { scope, userId: req.userId });
    return resp.success(res, {
      answer: result.answer,
      citations: result.citations,
      chunkCount: result.chunks.length,
    });
  } catch (err) {
    next(err);
  }
}

async function streamAnswer(
  req: AuthRequest,
  res: Response,
  question: string,
  scope: Parameters<typeof answerWithCitations>[1]['scope']
) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const abortController = new AbortController();
  req.on('close', () => abortController.abort());

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await answerWithCitations(question, {
      scope,
      userId: req.userId,
      signal: abortController.signal,
      onToken: (token) => sendEvent('token', token),
    });
    sendEvent('citations', {
      citations: result.citations,
      chunkCount: result.chunks.length,
    });
    sendEvent('done', { ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, 'ask-course stream failed');
    sendEvent('error', { message: msg });
  } finally {
    res.end();
  }
}
