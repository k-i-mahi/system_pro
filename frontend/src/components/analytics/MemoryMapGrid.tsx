import { useState } from 'react';
import { Brain, Info } from 'lucide-react';

export type MemoryMapRow = {
  topicId: string;
  topicTitle: string;
  teachingWeek: number | null;
  expertiseLevel: number;
  rawExpertise: number;
  lastStudied: string | null;
  studyMinutes: number;
  materialWeeks: number[];
};

type Props = {
  memoryMap: MemoryMapRow[];
  isLoading?: boolean;
};

// Mirrors the backend decay formula: 0.95^(days/7)
function estimateRetentionAtWeek(
  row: MemoryMapRow,
  currentWeekNumber: number,
  col: number
): number | null {
  if (row.teachingWeek === null) return null;
  if (col < row.teachingWeek) return null;

  // If no progress yet, treat the topic as not studied
  if (row.rawExpertise === 0 && !row.lastStudied) {
    // After teaching week: starts at 0 (not yet studied by student)
    return 0;
  }

  // Week-based days delta: 7 days per week difference
  // Current column relative to "now" (we treat the last known expertise as today)
  const weeksAgo = currentWeekNumber - col;
  const daysAgo = weeksAgo * 7;

  // Project from current expertise level forward or backward in time
  const decayPerDay = Math.pow(0.95, 1 / 7);
  if (daysAgo >= 0) {
    // Col is in the past — expertise was higher (reverse decay)
    return Math.min(row.expertiseLevel * Math.pow(1 / decayPerDay, daysAgo), 1.0);
  } else {
    // Col is in the future — expertise decays further
    return row.expertiseLevel * Math.pow(decayPerDay, -daysAgo);
  }
}

type CellColor = 'green' | 'yellow' | 'red' | 'gray' | 'none';

function getCellColor(retention: number | null): CellColor {
  if (retention === null) return 'gray';
  if (retention === 0) return 'red';
  if (retention >= 0.65) return 'green';
  if (retention >= 0.35) return 'yellow';
  return 'red';
}

const colorStyles: Record<CellColor, string> = {
  green: 'bg-green-100 text-green-800 border-green-200',
  yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  red: 'bg-red-100 text-red-800 border-red-200',
  gray: 'bg-bg-main text-text-muted border-border',
  none: 'border-transparent',
};

const colorDotStyles: Record<CellColor, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-400',
  red: 'bg-red-500',
  gray: 'bg-gray-300',
  none: 'bg-transparent',
};

function formatDate(iso: string | null): string {
  if (!iso) return 'Never';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Never';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type TooltipData = {
  topicTitle: string;
  week: number;
  retention: number | null;
  lastStudied: string | null;
  materialCount: number;
  x: number;
  y: number;
};

export default function MemoryMapGrid({ memoryMap, isLoading }: Props) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  if (isLoading) {
    return (
      <div className="card animate-pulse">
        <div className="h-4 w-40 rounded bg-bg-main mb-4" />
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 w-full rounded bg-bg-main" />
          ))}
        </div>
      </div>
    );
  }

  const validRows = memoryMap.filter((r) => r.teachingWeek !== null);

  if (memoryMap.length === 0 || validRows.length === 0) {
    return (
      <div className="card flex flex-col items-center justify-center py-12 text-center">
        <Brain size={36} className="mb-3 text-text-muted" />
        <p className="text-sm font-medium text-text-secondary">Memory Map</p>
        <p className="mt-1 text-xs text-text-muted max-w-xs">
          No topics with week data yet — assign weeks to topics in Course Detail to see the memory map.
        </p>
      </div>
    );
  }

  // Determine week columns
  const minWeek = Math.min(...validRows.map((r) => r.teachingWeek!));
  const allWeeks = new Set<number>();
  validRows.forEach((r) => {
    if (r.teachingWeek) allWeeks.add(r.teachingWeek);
    r.materialWeeks.forEach((w) => allWeeks.add(w));
  });
  const maxWeek = Math.max(...Array.from(allWeeks), minWeek + 3);
  const totalWeeks = Math.max(maxWeek, minWeek + 3);
  const weekColumns = Array.from({ length: totalWeeks - minWeek + 1 }, (_, i) => minWeek + i);

  // "Current" week estimate for decay calculations: use max teaching week + 1
  const currentWeekNumber = totalWeeks;

  const sortedRows = [...validRows].sort((a, b) => (a.teachingWeek ?? 0) - (b.teachingWeek ?? 0));

  function handleCellMouseEnter(
    e: React.MouseEvent,
    row: MemoryMapRow,
    col: number,
    retention: number | null
  ) {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const matCount = row.materialWeeks.filter((w) => w === col).length;
    setTooltip({
      topicTitle: row.topicTitle,
      week: col,
      retention,
      lastStudied: row.lastStudied,
      materialCount: matCount,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  }

  return (
    <div className="card p-0 overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-primary" />
          <h3 className="font-semibold">Memory Map</h3>
          <span className="text-xs text-text-muted">— retention estimate by week</span>
        </div>
        {/* Legend */}
        <div className="flex items-center gap-3 text-xs text-text-secondary">
          {(
            [
              { color: 'green', label: 'Strong' },
              { color: 'yellow', label: 'Review' },
              { color: 'red', label: 'At risk' },
              { color: 'gray', label: 'Not taught' },
            ] as { color: CellColor; label: string }[]
          ).map(({ color, label }) => (
            <span key={color} className="flex items-center gap-1">
              <span className={`inline-block w-3 h-3 rounded-sm ${colorDotStyles[color]}`} />
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Scrollable grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse min-w-max">
          <thead>
            <tr className="bg-bg-main border-b border-border">
              <th className="sticky left-0 z-10 bg-bg-main px-3 py-2 text-left font-medium text-text-secondary min-w-[48px]">
                Wk
              </th>
              <th className="sticky left-12 z-10 bg-bg-main px-3 py-2 text-left font-medium text-text-secondary min-w-[180px]">
                Topic
              </th>
              <th className="sticky left-[228px] z-10 bg-bg-main px-3 py-2 text-left font-medium text-text-secondary min-w-[100px]">
                Last Studied
              </th>
              {weekColumns.map((w) => (
                <th key={w} className="px-2 py-2 text-center font-medium text-text-secondary min-w-[52px]">
                  W{w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={row.topicId} className="border-b border-border/60 hover:bg-bg-main/30 transition-colors">
                <td className="sticky left-0 z-10 bg-white px-3 py-2 text-text-secondary font-medium">
                  {row.teachingWeek != null ? `W${row.teachingWeek}` : '–'}
                </td>
                <td className="sticky left-12 z-10 bg-white px-3 py-2 font-medium max-w-[180px] truncate" title={row.topicTitle}>
                  {row.topicTitle}
                </td>
                <td className="sticky left-[228px] z-10 bg-white px-3 py-2 text-text-muted whitespace-nowrap">
                  {formatDate(row.lastStudied)}
                </td>
                {weekColumns.map((col) => {
                  const retention = estimateRetentionAtWeek(row, currentWeekNumber, col);
                  const color = getCellColor(retention);
                  const hasMaterial = row.materialWeeks.includes(col);
                  return (
                    <td
                      key={col}
                      className={`px-1 py-1 text-center cursor-default`}
                      onMouseEnter={(e) => handleCellMouseEnter(e, row, col, retention)}
                      onMouseLeave={() => setTooltip(null)}
                    >
                      <div
                        className={`relative mx-auto w-9 h-7 rounded flex items-center justify-center border text-[10px] font-medium transition-colors ${colorStyles[color]}`}
                      >
                        {retention !== null && retention > 0
                          ? `${Math.round(retention * 100)}%`
                          : color === 'gray'
                          ? '–'
                          : '0%'}
                        {hasMaterial && (
                          <span
                            className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary border border-white"
                            title="Material uploaded this week"
                          />
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Info note */}
      <div className="px-4 py-2 border-t border-border flex items-center gap-1.5 text-xs text-text-muted">
        <Info size={12} />
        <span>Retention estimated using spaced-repetition decay. Blue dots indicate uploaded materials.</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none -translate-x-1/2 -translate-y-full"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="bg-bg-card border border-border rounded-lg shadow-lg px-3 py-2 text-xs max-w-48">
            <p className="font-medium truncate">{tooltip.topicTitle}</p>
            <p className="text-text-secondary mt-0.5">Week {tooltip.week}</p>
            <p className="text-text-secondary">
              Retention:{' '}
              <span className="font-medium">
                {tooltip.retention !== null
                  ? `${Math.round(tooltip.retention * 100)}%`
                  : 'Not yet taught'}
              </span>
            </p>
            <p className="text-text-secondary">Last studied: {formatDate(tooltip.lastStudied)}</p>
            {tooltip.materialCount > 0 && (
              <p className="text-primary mt-0.5">{tooltip.materialCount} material(s) this week</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
