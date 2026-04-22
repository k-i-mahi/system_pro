import { MessageCircle, BookOpen, Brain, FileQuestion, Globe } from 'lucide-react';
import { cn } from '../../lib/utils';

export type TutorMode = 'chat' | 'ask-course' | 'explain' | 'quiz' | 'resources';

const MODES: Array<{ id: TutorMode; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }> = [
  { id: 'chat', label: 'Chat', icon: MessageCircle, hint: 'Free-form conversation with the tutor' },
  { id: 'ask-course', label: 'Ask Course', icon: BookOpen, hint: 'Grounded answers with citations from your materials' },
  { id: 'explain', label: 'Explain', icon: Brain, hint: 'Structured explanation at your mastery level' },
  { id: 'quiz', label: 'Quiz', icon: FileQuestion, hint: 'Adaptive-difficulty MCQ practice' },
  { id: 'resources', label: 'Resources', icon: Globe, hint: 'Discover videos, articles, papers and blog posts' },
];

interface Props {
  value: TutorMode;
  onChange: (mode: TutorMode) => void;
}

export function ModeSwitcher({ value, onChange }: Props) {
  return (
    <div
      role="tablist"
      aria-label="Tutor mode"
      className="inline-flex rounded-lg border border-border bg-bg-card p-1"
    >
      {MODES.map((m) => {
        const Icon = m.icon;
        const active = value === m.id;
        return (
          <button
            key={m.id}
            role="tab"
            aria-selected={active}
            aria-label={m.hint}
            onClick={() => onChange(m.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              active ? 'bg-primary text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}
