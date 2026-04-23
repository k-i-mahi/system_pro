from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.course import TopicProgress, Topic, Course
from app.models.misc import LlmCall
from app.models.enums import LlmCallStatus


async def get_evaluation_metrics(db: AsyncSession, user_id: str) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=7)

    route_stats_rows = (await db.execute(
        text("""
            SELECT
              "route",
              COUNT(*)::bigint AS count,
              AVG("latencyMs")::float AS avg_latency,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY "latencyMs")::float AS p95_latency,
              SUM("promptTokens")::bigint AS prompt_tokens,
              SUM("completionTokens")::bigint AS completion_tokens
            FROM "LlmCall"
            WHERE "createdAt" >= :since
            GROUP BY "route"
            ORDER BY count DESC
        """),
        {"since": since},
    )).fetchall()

    error_count_rows = (await db.execute(
        text("""
            SELECT "route", "status"::text AS status, COUNT(*)::bigint AS count
            FROM "LlmCall"
            WHERE "createdAt" >= :since
            GROUP BY "route", "status"
        """),
        {"since": since},
    )).fetchall()

    recent_failures = (await db.execute(
        select(LlmCall)
        .where(
            LlmCall.status.in_([LlmCallStatus.ERROR, LlmCallStatus.TIMEOUT]),
            LlmCall.created_at >= since,
        )
        .order_by(LlmCall.created_at.desc())
        .limit(20)
    )).scalars().all()

    posteriors_raw = (await db.execute(
        select(TopicProgress, Topic, Course)
        .join(Topic, TopicProgress.topic_id == Topic.id)
        .join(Course, Topic.course_id == Course.id)
        .where(TopicProgress.user_id == user_id)
        .order_by(TopicProgress.last_studied.desc())
        .limit(40)
    )).all()

    def _posterior(tp: TopicProgress, topic: Topic, course: Course) -> dict:
        a, b = tp.alpha, tp.beta
        mean = a / (a + b)
        variance = (a * b) / ((a + b) ** 2 * (a + b + 1))
        sd = variance ** 0.5
        return {
            "topicId": tp.topic_id,
            "topicTitle": topic.title,
            "courseCode": course.course_code,
            "alpha": a,
            "beta": b,
            "mean": mean,
            "lower": max(0.0, mean - 1.96 * sd),
            "upper": min(1.0, mean + 1.96 * sd),
        }

    return {
        "windowDays": 7,
        "routeStats": [
            {
                "route": r.route,
                "count": int(r.count),
                "avgLatencyMs": round(r.avg_latency or 0),
                "p95LatencyMs": round(r.p95_latency or 0),
                "promptTokens": int(r.prompt_tokens or 0),
                "completionTokens": int(r.completion_tokens or 0),
            }
            for r in route_stats_rows
        ],
        "errorCounts": [
            {"route": r.route, "status": r.status, "count": int(r.count)}
            for r in error_count_rows
        ],
        "recentFailures": [
            {
                "id": f.id,
                "route": f.route,
                "status": f.status,
                "errorMsg": f.error_msg,
                "latencyMs": f.latency_ms,
                "createdAt": f.created_at,
            }
            for f in recent_failures
        ],
        "posteriors": [_posterior(tp, topic, course) for tp, topic, course in posteriors_raw],
    }
