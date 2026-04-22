import { useState } from 'react';
import { ChevronDown, ChevronRight, Lightbulb, Wrench, CheckCircle2, MessageSquare } from 'lucide-react';
import { cn } from '../../lib/utils';

export type TutorTurnKind = 'thought' | 'tool_call' | 'tool_result' | 'answer';

export interface TutorTurn {
  kind: TutorTurnKind;
  content: string;
  toolName?: string;
  elapsedMs?: number;
  iteration?: number;
}

interface Props {
  turns: TutorTurn[];
  running?: boolean;
  defaultOpen?: boolean;
  className?: string;
}

const ICONS: Record<TutorTurnKind, React.ComponentType<{ className?: string }>> = {
  thought: Lightbulb,
  tool_call: Wrench,
  tool_result: CheckCircle2,
  answer: MessageSquare,
};

const KIND_STYLES: Record<TutorTurnKind, string> = {
  thought: 'text-warning',
  tool_call: 'text-info',
  tool_result: 'text-accent',
  answer: 'text-primary',
};

function formatContent(content: string, maxLen = 320): string {
  if (content.length <= maxLen) return content;
  return content.slice(0, maxLen) + '…';
}

export function TutorTrace({ turns, running = false, defaultOpen = false, className }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  if (turns.length === 0 && !running) return null;

  const visible = open ? turns : turns.slice(-2);

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-bg-card/60 text-xs',
        className
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 font-medium text-text-secondary hover:text-text-primary"
      >
        <span className="inline-flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Tutor thinking
          {running && (
            <span className="ml-1 inline-flex items-center gap-1 text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              running
            </span>
          )}
        </span>
        <span className="text-text-secondary">
          {turns.length} {turns.length === 1 ? 'step' : 'steps'}
        </span>
      </button>

      {(open || running) && (
        <ol className="space-y-1 border-t border-border px-3 py-2">
          {visible.map((turn, i) => {
            const Icon = ICONS[turn.kind];
            const kindStyle = KIND_STYLES[turn.kind];
            return (
              <li key={i} className="flex items-start gap-2">
                <Icon className={cn('mt-0.5 h-3.5 w-3.5 flex-shrink-0', kindStyle)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-text-secondary">
                    <span className={cn('font-medium capitalize', kindStyle)}>
                      {turn.kind.replace('_', ' ')}
                    </span>
                    {turn.toolName && (
                      <span className="rounded bg-bg-main px-1.5 py-0.5 font-mono text-[10px]">
                        {turn.toolName}
                      </span>
                    )}
                    {typeof turn.iteration === 'number' && (
                      <span className="text-[10px] text-text-secondary">
                        #{turn.iteration}
                      </span>
                    )}
                    {typeof turn.elapsedMs === 'number' && (
                      <span className="ml-auto text-[10px] text-text-secondary">
                        {turn.elapsedMs}ms
                      </span>
                    )}
                  </div>
                  <pre className="mt-0.5 whitespace-pre-wrap break-words font-sans text-text-primary">
                    {formatContent(turn.content)}
                  </pre>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
