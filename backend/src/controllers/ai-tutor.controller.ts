import { Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import {
  chatCompletion,
  chatCompletionStructured,
  buildSystemPrompt,
} from '../services/ollama.service.js';
import { searchWeb } from '../services/search.service.js';
import * as resp from '../utils/response.js';
import type { AuthRequest } from '../middleware/auth.js';
import { logger } from '../services/observability/logger.js';

export async function chat(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { messages, topicId, courseId, mode } = req.body;

    // Build context
    let courseName: string | undefined;
    let topicTitle: string | undefined;

    if (courseId) {
      const course = await prisma.course.findUnique({ where: { id: courseId }, select: { courseName: true } });
      courseName = course?.courseName;
    }
    if (topicId) {
      const topic = await prisma.topic.findUnique({
        where: { id: topicId },
        include: { course: { select: { courseName: true } } },
      });
      topicTitle = topic?.title;
      if (!courseName) courseName = topic?.course?.courseName;
    }

    const systemPrompt = buildSystemPrompt(courseName, topicTitle);

    // Add mode-specific instructions
    let modeInstruction = '';
    if (mode === 'explain') modeInstruction = '\nExplain the topic in detail with examples.';
    if (mode === 'quiz') modeInstruction = '\nGenerate quiz questions in strict JSON format.';

    const fullMessages = [
      { role: 'system' as const, content: systemPrompt + modeInstruction },
      ...messages,
    ];

    // Set up SSE for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let fullResponse = '';
    try {
      await chatCompletion(fullMessages, {
        route: 'tutor.chat',
        logContext: {
          userId: req.userId,
          metadata: { topicId: topicId ?? null, courseId: courseId ?? null, mode: mode ?? null },
        },
        onChunk: (chunk) => {
          fullResponse += chunk;
          res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
        },
      });
    } catch (aiErr: any) {
      const errMsg = aiErr?.cause?.code === 'ECONNREFUSED'
        ? 'AI service (Ollama) is not running. Please start it and try again.'
        : `AI service error: ${aiErr.message || 'Unknown error'}`;
      res.write(`data: ${JSON.stringify({ content: `\n\n⚠️ ${errMsg}` })}\n\n`);
    }

    // Update study time if topic is specified
    if (topicId && req.userId) {
      await prisma.topicProgress.upsert({
        where: { userId_topicId: { userId: req.userId, topicId } },
        create: { userId: req.userId, topicId, studyMinutes: 1, lastStudied: new Date() },
        update: { studyMinutes: { increment: 1 }, lastStudied: new Date() },
      });
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    next(err);
  }
}

// JSON schema passed verbatim to Ollama's `format` parameter. qwen2.5:7b-instruct
// emits JSON that matches this with very high reliability, killing the brittle
// regex-extraction that preceded this migration.
const QUIZ_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          correct: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
          explanation: { type: 'string' },
          difficulty: { type: 'integer', minimum: 1, maximum: 5 },
        },
        required: ['id', 'question', 'options', 'correct'],
      },
    },
  },
  required: ['questions'],
};

interface GeneratedQuiz {
  questions: Array<{
    id: string;
    question: string;
    options: string[];
    correct: string;
    explanation?: string;
    difficulty?: number;
  }>;
}

export async function generateQuiz(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId, questionCount } = req.body;

    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      include: { course: { select: { courseName: true } } },
    });

    if (!topic) {
      return resp.error(res, 404, 'NOT_FOUND', 'Topic not found');
    }

    // Adaptive difficulty target: map the student's Beta posterior mean to a 1-5 scale.
    let targetDifficulty = 3;
    if (req.userId) {
      const progress = await prisma.topicProgress.findUnique({
        where: { userId_topicId: { userId: req.userId, topicId } },
        select: { alpha: true, beta: true },
      });
      if (progress) {
        const mean = progress.alpha / (progress.alpha + progress.beta);
        targetDifficulty = Math.max(1, Math.min(5, Math.round(1 + mean * 4)));
      }
    }

    const prompt = `Generate exactly ${questionCount} multiple choice questions about "${topic.title}" for the course "${topic.course.courseName}".
Target difficulty: ${targetDifficulty}/5 (calibrated to the student's current mastery).
Each question must have exactly 4 options labelled "A) ...", "B) ...", "C) ...", "D) ...".
Include a 1-sentence "explanation" of why the correct answer is right.`;

    try {
      const parsed = await chatCompletionStructured<GeneratedQuiz>(
        [
          { role: 'system', content: buildSystemPrompt(topic.course.courseName, topic.title) },
          { role: 'user', content: prompt },
        ],
        QUIZ_SCHEMA,
        {
          route: 'tutor.generate-quiz',
          temperature: 0.4,
          logContext: { userId: req.userId, metadata: { topicId, targetDifficulty } },
        }
      );

      if (!parsed?.questions?.length) {
        return resp.error(res, 500, 'AI_ERROR', 'Quiz generation returned no questions');
      }

      return resp.success(res, parsed);
    } catch (err) {
      logger.error({ err: (err as Error).message, topicId }, 'generateQuiz structured parse failed');
      return resp.error(res, 500, 'AI_ERROR', 'Failed to generate quiz. Please try again.');
    }
  } catch (err) {
    next(err);
  }
}

export async function submitQuiz(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { topicId, answers, questions, timeTaken } = req.body;

    let correct = 0;
    const breakdown = questions.map((q: any) => {
      const userAnswer = answers.find((a: any) => a.questionId === q.id)?.selected;
      const isCorrect = userAnswer === q.correct;
      if (isCorrect) correct++;
      return { questionId: q.id, question: q.question, correct: q.correct, userAnswer, isCorrect };
    });

    const incorrect = questions.length - correct;
    const score = questions.length > 0 ? correct / questions.length : 0;

    const attempt = await prisma.examAttempt.create({
      data: {
        userId: req.userId!,
        topicId,
        questions: questions as any,
        score: score * 100,
        totalQ: questions.length,
        timeTaken: timeTaken || 0,
      },
    });

    // Bayesian update: Beta(alpha, beta) posterior starts at Beta(1,1) (uniform prior).
    // Each correct answer → alpha += 1, each incorrect → beta += 1. Posterior mean
    // is the student's expertise; the 95% credible interval quantifies uncertainty
    // so the UI can show confidence bands instead of a single point estimate.
    let posterior: { alpha: number; beta: number; mean: number; lower: number; upper: number } | null = null;
    if (req.userId) {
      const updated = await prisma.topicProgress.upsert({
        where: { userId_topicId: { userId: req.userId, topicId } },
        create: {
          userId: req.userId,
          topicId,
          alpha: 1 + correct,
          beta: 1 + incorrect,
          expertiseLevel: (1 + correct) / (2 + correct + incorrect),
          examScore: score * 100,
        },
        update: {
          alpha: { increment: correct },
          beta: { increment: incorrect },
          examScore: score * 100,
        },
        select: { alpha: true, beta: true },
      });

      const mean = updated.alpha / (updated.alpha + updated.beta);
      const { lower, upper } = betaCredibleInterval(updated.alpha, updated.beta, 0.95);
      posterior = { alpha: updated.alpha, beta: updated.beta, mean, lower, upper };

      // Keep expertiseLevel in sync with the posterior mean so legacy reads stay correct.
      await prisma.topicProgress.update({
        where: { userId_topicId: { userId: req.userId, topicId } },
        data: { expertiseLevel: mean },
      });
    }

    resp.success(res, {
      attemptId: attempt.id,
      score: correct,
      total: questions.length,
      percentage: Math.round(score * 100),
      breakdown,
      posterior,
    });
  } catch (err) {
    next(err);
  }
}

export async function searchResources(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { query, type, limit } = req.query as { query: string; type?: string; limit?: string };
    const results = await searchWeb(query, type, limit ? parseInt(limit) : 10);
    resp.success(res, results);
  } catch (err) {
    next(err);
  }
}

/**
 * 95% credible interval for Beta(α, β) computed via a normal approximation.
 * For α+β ≥ 10 this matches the true Beta quantile within ~0.01 — good enough
 * for UI confidence bands without pulling in scipy.
 */
function betaCredibleInterval(
  alpha: number,
  beta: number,
  level: number = 0.95
): { lower: number; upper: number } {
  const mean = alpha / (alpha + beta);
  const variance = (alpha * beta) / (Math.pow(alpha + beta, 2) * (alpha + beta + 1));
  const sd = Math.sqrt(variance);
  const z = level === 0.95 ? 1.96 : level === 0.9 ? 1.645 : 2.576;
  return {
    lower: Math.max(0, mean - z * sd),
    upper: Math.min(1, mean + z * sd),
  };
}
