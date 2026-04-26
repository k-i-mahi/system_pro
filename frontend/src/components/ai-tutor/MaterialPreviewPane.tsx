import { useEffect, useState } from 'react';
import { ExternalLink, FileText, X } from 'lucide-react';
import { fetchWithApiAuth } from '@/lib/api';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import type { Citation } from './CitationChip';
import { cn } from '../../lib/utils';

interface Props {
  citation: Citation | null;
  onClose?: () => void;
  className?: string;
}

interface MaterialMeta {
  id: string;
  title: string;
  fileUrl: string | null;
  fileType: string | null;
}

const API_BASE = '/api';

function extensionOf(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
  return match ? match[1].toLowerCase() : null;
}

export function MaterialPreviewPane({ citation, onClose, className }: Props) {
  const [material, setMaterial] = useState<MaterialMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!citation) {
      setMaterial(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchWithApiAuth(`${API_BASE}/materials/${citation.materialId}`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const raw = (await r.json()) as { data?: MaterialMeta };
        if (!cancelled) setMaterial(raw.data ?? null);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [citation]);

  if (!citation) return null;

  const ext = extensionOf(material?.fileUrl ?? null);
  const isPdf = ext === 'pdf';
  const pageAnchor = citation.page && isPdf ? `#page=${citation.page}` : '';
  const viewerSrc = material?.fileUrl ? `${material.fileUrl}${pageAnchor}` : null;

  return (
    <aside
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-xl border border-border bg-bg-card',
        className
      )}
      aria-label="Cited material preview"
    >
      <header className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 text-xs text-text-secondary">
            <FileText className="h-3.5 w-3.5" />
            <span className="font-medium uppercase tracking-wide">
              Citation [{citation.index}]
            </span>
          </div>
          <h3 className="mt-1 truncate text-sm font-semibold text-text-primary">
            {material?.title ?? citation.materialTitle}
          </h3>
          <p className="text-xs text-text-secondary">
            {[
              citation.page ? `p. ${citation.page}` : null,
              citation.heading ? `§ ${citation.heading}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-hidden">
        {loading && (
          <div className="p-4">
            <Skeleton className="mb-2 h-4 w-full" />
            <Skeleton className="mb-2 h-4 w-11/12" />
            <Skeleton className="h-4 w-8/12" />
          </div>
        )}

        {error && (
          <div className="p-4 text-sm text-danger">Failed to load material: {error}</div>
        )}

        {!loading && !error && viewerSrc && isPdf && (
          <iframe
            src={viewerSrc}
            title={material?.title ?? 'Material preview'}
            className="h-full w-full border-0"
          />
        )}

        {!loading && !error && (!viewerSrc || !isPdf) && (
          <div className="space-y-3 p-4 text-sm">
            <div className="rounded-lg border border-border bg-bg-main p-3 text-text-primary">
              <p className="text-xs font-medium uppercase text-text-secondary">
                Cited snippet
              </p>
              <p className="mt-1 whitespace-pre-wrap leading-relaxed">
                {citation.snippet}
              </p>
            </div>
            {material?.fileUrl && (
              <a
                href={material.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                Open full material
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
