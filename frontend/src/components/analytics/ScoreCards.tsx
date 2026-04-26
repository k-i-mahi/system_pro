import { ClipboardList } from 'lucide-react';

export type Scores = {
  ct1: number | null;
  ct2: number | null;
  ct3: number | null;
  lab?: number | null;
};

type Props = {
  scores: Scores | undefined;
  courseType?: string;
  isLoading?: boolean;
};

function ScoreCell({ label, value }: { label: string; value: number | null | undefined }) {
  const isEvaluated = value !== null && value !== undefined;
  return (
    <div className="flex flex-col items-center rounded-xl bg-bg-main p-4 text-center">
      <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">{label}</p>
      {isEvaluated ? (
        <p className="text-3xl font-bold tabular-nums">{value}</p>
      ) : (
        <p className="text-sm text-text-muted italic">Not evaluated yet</p>
      )}
    </div>
  );
}

export default function ScoreCards({ scores, courseType, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="card">
        <div className="h-4 w-32 rounded bg-bg-main mb-4 animate-pulse" />
        <div className="grid grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-bg-main animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const isLab = courseType === 'LAB' || courseType === 'CourseType.LAB';

  return (
    <div className="card">
      <div className="mb-4 flex items-center gap-2">
        <ClipboardList size={18} className="text-primary" />
        <h3 className="font-semibold">
          {isLab ? 'Lab Score' : 'Class Test Scores'}
        </h3>
      </div>

      {isLab ? (
        <div className="max-w-xs">
          <ScoreCell label="Lab / Assignment" value={scores?.lab} />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          <ScoreCell label="CT 1" value={scores?.ct1} />
          <ScoreCell label="CT 2" value={scores?.ct2} />
          <ScoreCell label="CT 3" value={scores?.ct3} />
        </div>
      )}
    </div>
  );
}
