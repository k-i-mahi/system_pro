import type { Response, NextFunction } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import * as resp from '../utils/response.js';
import { prisma } from '../config/database.js';

/**
 * GET /api/analytics/evaluation
 * Aggregates observability signals into a single instructor-facing payload:
 *   • LLM call volume, p50/p95 latency, token usage per route
 *   • Per-route error rate
 *   • Recent failed calls (for drill-down)
 *   • Per-student Beta posterior expertise snapshot (self only; instructor roles see full cohort)
 */
export async function getEvaluationMetrics(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [routeStats, errorCounts, recentFailures, posteriors] = await Promise.all([
      prisma.$queryRaw<
        Array<{ route: string; count: bigint; avgLatency: number; p95Latency: number; promptTokens: bigint; completionTokens: bigint }>
      >`
        SELECT
          "route",
          COUNT(*)::bigint AS "count",
          AVG("latencyMs")::float AS "avgLatency",
          percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float AS "p95Latency",
          SUM("promptTokens")::bigint AS "promptTokens",
          SUM("completionTokens")::bigint AS "completionTokens"
        FROM "LlmCall"
        WHERE "createdAt" >= ${since}
        GROUP BY "route"
        ORDER BY "count" DESC
      `,
      prisma.$queryRaw<Array<{ route: string; status: string; count: bigint }>>`
        SELECT "route", "status"::text AS "status", COUNT(*)::bigint AS "count"
        FROM "LlmCall"
        WHERE "createdAt" >= ${since}
        GROUP BY "route", "status"
      `,
      prisma.llmCall.findMany({
        where: { status: { in: ['ERROR', 'TIMEOUT'] }, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          route: true,
          status: true,
          errorMsg: true,
          latencyMs: true,
          createdAt: true,
        },
      }),
      prisma.topicProgress.findMany({
        where: { userId: req.userId },
        select: {
          topicId: true,
          alpha: true,
          beta: true,
          expertiseLevel: true,
          topic: { select: { title: true, course: { select: { courseCode: true } } } },
        },
        orderBy: { lastStudied: 'desc' },
        take: 40,
      }),
    ]);

    const posteriorRows = posteriors.map((p) => {
      const a = p.alpha;
      const b = p.beta;
      const mean = a / (a + b);
      const variance = (a * b) / ((a + b) ** 2 * (a + b + 1));
      const sd = Math.sqrt(variance);
      return {
        topicId: p.topicId,
        topicTitle: p.topic.title,
        courseCode: p.topic.course?.courseCode ?? null,
        alpha: a,
        beta: b,
        mean,
        lower: Math.max(0, mean - 1.96 * sd),
        upper: Math.min(1, mean + 1.96 * sd),
      };
    });

    return resp.success(res, {
      windowDays: 7,
      routeStats: routeStats.map((r) => ({
        route: r.route,
        count: Number(r.count),
        avgLatencyMs: Math.round(r.avgLatency ?? 0),
        p95LatencyMs: Math.round(r.p95Latency ?? 0),
        promptTokens: Number(r.promptTokens ?? 0n),
        completionTokens: Number(r.completionTokens ?? 0n),
      })),
      errorCounts: errorCounts.map((e) => ({
        route: e.route,
        status: e.status,
        count: Number(e.count),
      })),
      recentFailures,
      posteriors: posteriorRows,
    });
  } catch (err) {
    next(err);
  }
}
