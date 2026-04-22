import { Brain, HelpCircle, Lightbulb, ListOrdered, ShieldAlert } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

export type TutorStrategy =
  | 'EXPLAIN'
  | 'SOCRATIC'
  | 'HINT_LADDER'
  | 'WORKED_EXAMPLE'
  | 'MISCONCEPTION_PROBE';

const META: Record<
  TutorStrategy,
  {
    label: string;
    variant: 'default' | 'info' | 'warning' | 'success' | 'danger';
    icon: React.ComponentType<{ className?: string }>;
    tooltip: string;
  }
> = {
  EXPLAIN: {
    label: 'Explain',
    variant: 'default',
    icon: Brain,
    tooltip: 'Structured explanation calibrated to your current mastery.',
  },
  SOCRATIC: {
    label: 'Socratic',
    variant: 'info',
    icon: HelpCircle,
    tooltip: 'Diagnostic questions surface gaps before supplying an answer.',
  },
  HINT_LADDER: {
    label: 'Hint Ladder',
    variant: 'warning',
    icon: ListOrdered,
    tooltip: 'Progressive hints — escalate only if an earlier rung did not unblock you.',
  },
  WORKED_EXAMPLE: {
    label: 'Worked Example',
    variant: 'success',
    icon: Lightbulb,
    tooltip: 'Fully worked reference solution before you attempt a similar problem.',
  },
  MISCONCEPTION_PROBE: {
    label: 'Misconception Probe',
    variant: 'danger',
    icon: ShieldAlert,
    tooltip: 'A common misconception was detected — targeted counter-example follows.',
  },
};

interface Props {
  strategy: TutorStrategy;
  className?: string;
}

export function StrategyBadge({ strategy, className }: Props) {
  const meta = META[strategy];
  const Icon = meta.icon;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant={meta.variant} className={className}>
            <Icon className="h-3 w-3" />
            {meta.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>
          <p className="max-w-xs text-xs">{meta.tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
