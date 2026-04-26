import { Users } from 'lucide-react';

export type AttendanceSummary = {
  attendedClasses: number;
  totalClasses: number;
  missedClasses: number;
  percentage: number;
  lastRecordedAt: string | null;
};

type Props = {
  summary: AttendanceSummary | undefined;
  isLoading?: boolean;
};

function getColorClass(percentage: number): string {
  if (percentage >= 75) return 'bg-accent';
  if (percentage >= 60) return 'bg-warning';
  return 'bg-danger';
}

function getTextColorClass(percentage: number): string {
  if (percentage >= 75) return 'text-accent';
  if (percentage >= 60) return 'text-warning';
  return 'text-danger';
}

export default function AttendanceProgressCard({ summary, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 w-24 rounded bg-bg-main mb-4" />
        <div className="h-10 w-20 rounded bg-bg-main mb-2" />
        <div className="h-3 w-40 rounded bg-bg-main mb-4" />
        <div className="h-3 w-full rounded bg-bg-main" />
      </div>
    );
  }

  if (!summary || summary.totalClasses === 0) {
    return (
      <div className="card flex flex-col items-center justify-center py-8 text-center">
        <Users size={32} className="mb-2 text-text-muted" />
        <p className="text-sm font-medium text-text-secondary">Attendance</p>
        <p className="mt-1 text-xs text-text-muted">No attendance records yet</p>
      </div>
    );
  }

  const { attendedClasses, totalClasses, percentage } = summary;
  const colorClass = getColorClass(percentage);
  const textColorClass = getTextColorClass(percentage);

  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-2">
        <Users size={18} className={textColorClass} />
        <h3 className="font-semibold">Attendance</h3>
      </div>

      <p className={`text-4xl font-bold tabular-nums ${textColorClass}`}>
        {percentage.toFixed(2)}%
      </p>
      <p className="mt-1 text-sm text-text-secondary">
        {attendedClasses} of {totalClasses} classes attended
      </p>

      <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-bg-main">
        <div
          className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>

      <div className="mt-2 flex justify-between text-xs text-text-muted">
        <span>{summary.missedClasses} missed</span>
        <span className={percentage >= 75 ? 'text-accent font-medium' : percentage >= 60 ? 'text-warning font-medium' : 'text-danger font-medium'}>
          {percentage >= 75 ? 'Good standing' : percentage >= 60 ? 'Borderline' : 'At risk'}
        </span>
      </div>
    </div>
  );
}
