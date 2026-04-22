import { BookOpen } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';
import { cn } from '../../lib/utils';

export interface Citation {
  index: number;
  materialId: string;
  materialTitle: string;
  page: number | null;
  heading: string | null;
  snippet: string;
}

interface Props {
  citation: Citation;
  onClick?: (c: Citation) => void;
  className?: string;
}

export function CitationChip({ citation, onClick, className }: Props) {
  const locator = [
    citation.materialTitle,
    citation.page ? `p.${citation.page}` : null,
    citation.heading ? `§ ${citation.heading}` : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => onClick?.(citation)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              className
            )}
            aria-label={`Citation ${citation.index}: ${locator}`}
          >
            <BookOpen className="h-3 w-3" />
            <span>[{citation.index}]</span>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-sm">
          <div className="space-y-1">
            <p className="font-medium text-text-primary">{locator}</p>
            <p className="line-clamp-3 text-text-secondary">{citation.snippet}</p>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Replace inline [n] tokens in an answer body with CitationChip components.
 * Keeps the original text intact where no match exists.
 */
export function renderWithCitations(
  text: string,
  citations: Citation[],
  onCitationClick?: (c: Citation) => void
): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /\[(\d+)\]/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) parts.push(text.slice(lastIdx, match.index));
    const idx = Number(match[1]);
    const citation = citations.find((c) => c.index === idx);
    if (citation) {
      parts.push(
        <CitationChip
          key={`${match.index}-${idx}`}
          citation={citation}
          onClick={onCitationClick}
        />
      );
    } else {
      parts.push(match[0]);
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}
