import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  Clock,
  Coins,
  Gauge,
  RefreshCw,
  Target,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import api from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

interface RouteStat {
  route: string;
  count: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  promptTokens: number;
  completionTokens: number;
}

interface ErrorCount {
  route: string;
  status: string;
  count: number;
}

interface Failure {
  id: string;
  route: string;
  status: string;
  errorMsg: string | null;
  latencyMs: number;
  createdAt: string;
}

interface Posterior {
  topicId: string;
  topicTitle: string;
  courseCode: string | null;
  alpha: number;
  beta: number;
  mean: number;
  lower: number;
  upper: number;
}

interface EvaluationPayload {
  windowDays: number;
  routeStats: RouteStat[];
  errorCounts: ErrorCount[];
  recentFailures: Failure[];
  posteriors: Posterior[];
}

const ROUTE_COLORS: Record<string, string> = {
  chat: '#3b82f6',
  'chat.structured': '#6366f1',
  embed: '#10b981',
  'ask-course': '#8b5cf6',
};

function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'primary',
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'primary' | 'accent' | 'warning' | 'danger';
}) {
  const toneCls = {
    primary: 'text-primary',
    accent: 'text-accent',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
          {label}
        </p>
        <Icon className={`h-5 w-5 ${toneCls}`} />
      </div>
      <p className="mt-2 text-2xl font-bold text-text-primary">{value}</p>
    </div>
  );
}

export default function InstructorEvalPage() {
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['evaluation-metrics'],
    queryFn: () =>
      api
        .get('/analytics/evaluation')
        .then((r) => r.data.data as EvaluationPayload),
  });

  const totals = useMemo(() => {
    if (!data) return null;
    const totalCalls = data.routeStats.reduce((a, r) => a + r.count, 0);
    const totalPromptTokens = data.routeStats.reduce((a, r) => a + r.promptTokens, 0);
    const totalCompletionTokens = data.routeStats.reduce(
      (a, r) => a + r.completionTokens,
      0
    );
    const errorCalls = data.errorCounts
      .filter((e) => e.status !== 'OK')
      .reduce((a, e) => a + e.count, 0);
    const avgLatency = data.routeStats.length
      ? Math.round(
          data.routeStats.reduce((a, r) => a + r.avgLatencyMs * r.count, 0) /
            Math.max(1, totalCalls)
        )
      : 0;
    const p95 = data.routeStats.length
      ? Math.max(...data.routeStats.map((r) => r.p95LatencyMs))
      : 0;
    return {
      totalCalls,
      errorCalls,
      errorRatePct: totalCalls ? Math.round((errorCalls / totalCalls) * 1000) / 10 : 0,
      avgLatency,
      p95,
      totalPromptTokens,
      totalCompletionTokens,
    };
  }, [data]);

  const latencyChartData = useMemo(
    () =>
      (data?.routeStats ?? []).map((r) => ({
        route: r.route,
        avg: r.avgLatencyMs,
        p95: r.p95LatencyMs,
      })),
    [data]
  );

  const posteriorChartData = useMemo(
    () =>
      (data?.posteriors ?? [])
        .slice(0, 12)
        .map((p) => ({
          name: p.topicTitle.length > 24 ? p.topicTitle.slice(0, 22) + '…' : p.topicTitle,
          mean: Math.round(p.mean * 100),
          lower: Math.round(p.lower * 100),
          upper: Math.round(p.upper * 100),
        })),
    [data]
  );

  function handleRefresh() {
    setRefreshedAt(new Date());
    refetch();
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">LLM Evaluation Dashboard</h1>
          <p className="text-sm text-text-secondary">
            Rolling {data?.windowDays ?? 7}-day observability over every Ollama call.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary">
            Refreshed {refreshedAt.toLocaleTimeString()}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            aria-label="Refresh metrics"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      {totals && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total calls" value={totals.totalCalls} icon={Activity} />
          <StatCard
            label="Avg latency"
            value={`${totals.avgLatency} ms`}
            icon={Clock}
            tone="accent"
          />
          <StatCard
            label="p95 latency"
            value={`${totals.p95} ms`}
            icon={Gauge}
            tone="warning"
          />
          <StatCard
            label="Error rate"
            value={`${totals.errorRatePct}%`}
            icon={AlertTriangle}
            tone={totals.errorRatePct > 5 ? 'danger' : 'accent'}
          />
        </div>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Clock className="h-4 w-4 text-primary" />
            Latency by route (ms)
          </h2>
          {latencyChartData.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-secondary">
              No calls recorded in the last {data?.windowDays} days.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={latencyChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="route" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 8,
                  }}
                />
                <Legend />
                <Bar dataKey="avg" name="Average" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="p95" name="p95" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Coins className="h-4 w-4 text-primary" />
            Call volume by route
          </h2>
          {data?.routeStats.length ? (
            <div className="space-y-3">
              {data.routeStats.map((r) => {
                const pct = totals
                  ? Math.round((r.count / totals.totalCalls) * 100)
                  : 0;
                const color = ROUTE_COLORS[r.route] ?? '#6b7280';
                return (
                  <div key={r.route}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-medium">{r.route}</span>
                      <span className="text-text-secondary">
                        {r.count.toLocaleString()} calls · {pct}%
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-bg-main">
                      <div
                        className="h-full transition-all"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-text-secondary">
                      <span>
                        Prompt: {r.promptTokens.toLocaleString()} · Completion:{' '}
                        {r.completionTokens.toLocaleString()}
                      </span>
                      <span>
                        {r.avgLatencyMs}ms avg · {r.p95LatencyMs}ms p95
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-text-secondary">
              No calls recorded in the window.
            </p>
          )}
        </div>
      </section>

      <section className="card">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-primary" />
          Your mastery (Beta posterior)
        </h2>
        {posteriorChartData.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-secondary">
            Continue studying with AI tutor to build a mastery profile.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={posteriorChartData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" height={60} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} unit="%" />
              <Tooltip
                contentStyle={{
                  background: 'var(--color-bg-card)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                }}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="upper"
                name="95% upper"
                stroke="#94a3b8"
                strokeDasharray="4 2"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="mean"
                name="Posterior mean"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="lower"
                name="95% lower"
                stroke="#94a3b8"
                strokeDasharray="4 2"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </section>

      <section className="card">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-danger" />
          Recent failures
        </h2>
        {data?.recentFailures.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-text-secondary">
                  <th className="py-2 pr-3 font-medium">Time</th>
                  <th className="py-2 pr-3 font-medium">Route</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Latency</th>
                  <th className="py-2 pr-3 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {data.recentFailures.map((f) => (
                  <tr key={f.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 text-text-secondary">
                      {new Date(f.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 font-mono">{f.route}</td>
                    <td className="py-2 pr-3">
                      <Badge
                        variant={f.status === 'TIMEOUT' ? 'warning' : 'danger'}
                      >
                        {f.status}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3 text-text-secondary">
                      {f.latencyMs}ms
                    </td>
                    <td className="py-2 pr-3 text-text-primary">
                      <span className="line-clamp-2">{f.errorMsg ?? '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-text-secondary">
            No failures recorded. 🎉
          </p>
        )}
      </section>
    </div>
  );
}
