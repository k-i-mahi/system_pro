import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, RefreshCw, Send, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { CitationChip, renderWithCitations, type Citation } from './CitationChip';
import { cn } from '../../lib/utils';

interface Answer {
  question: string;
  body: string;
  citations: Citation[];
  loading: boolean;
}

export interface CourseMaterialOption {
  id: string;
  title: string;
  fileType?: string;
  hasEmbeddings?: boolean;
  ingestStatus?: string;
  chunkCount?: number;
  ingestError?: string | null;
}

interface Props {
  courseId?: string;
  topicId?: string;
  materials?: CourseMaterialOption[];
  onCitationClick?: (c: Citation) => void;
}

function ingestBadge(m: CourseMaterialOption): { label: string; className: string } {
  const st = m.ingestStatus || 'PENDING';
  if (st === 'DONE' && m.hasEmbeddings && (m.chunkCount ?? 0) > 0) {
    return { label: 'Ready', className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' };
  }
  if (st === 'FAILED' || (st === 'DONE' && !m.hasEmbeddings)) {
    return { label: 'Failed', className: 'bg-destructive/15 text-destructive' };
  }
  if (st === 'PROCESSING') {
    return { label: 'Indexing…', className: 'bg-primary/15 text-primary' };
  }
  return { label: 'Queued', className: 'bg-amber-500/15 text-amber-800 dark:text-amber-300' };
}

export function AskCoursePane({ courseId, topicId, materials, onCitationClick }: Props) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<string[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const user = useAuthStore((s) => s.user);

  const fileMaterials = useMemo(
    () => (materials ?? []).filter((m) => m.fileType !== 'LINK'),
    [materials]
  );

  const canReingest = user?.role === 'TUTOR' || user?.role === 'ADMIN' || user?.role === 'MENTOR';

  useEffect(() => {
    setSelectedMaterialIds(fileMaterials.map((m) => m.id));
  }, [topicId, fileMaterials]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [answers]);

  useEffect(() => () => abortRef.current?.abort(), []);

  function toggleMaterial(id: string) {
    setSelectedMaterialIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function reingest(materialId: string) {
    if (!courseId || !topicId) return;
    try {
      const r = await fetch(
        `/api/courses/${courseId}/topics/${topicId}/materials/${materialId}/reingest`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${useAuthStore.getState().accessToken || ''}`,
          },
        }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      toast.success('Re-index started for this file.');
    } catch {
      toast.error('Could not start re-index.');
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || streaming) return;
    if (!courseId) {
      toast.error('Select a course to ground your question.');
      return;
    }
    if (fileMaterials.length > 0 && selectedMaterialIds.length === 0) {
      toast.error('Select at least one file to search, or re-select all materials.');
      return;
    }

    setAnswers((prev) => [...prev, { question: q, body: '', citations: [], loading: true }]);
    setQuestion('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const body: Record<string, unknown> = { question: q, courseId, stream: true };
    if (topicId) body.topicId = topicId;
    if (
      fileMaterials.length > 0 &&
      selectedMaterialIds.length > 0 &&
      selectedMaterialIds.length < fileMaterials.length
    ) {
      body.materialIds = selectedMaterialIds;
    }

    try {
      const response = await fetch('/api/ai-tutor/ask-course', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAuthStore.getState().accessToken || ''}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = 'token';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
            continue;
          }
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (!data) continue;

          try {
            const parsed = JSON.parse(data) as Record<string, unknown>;
            if (currentEvent === 'meta' && parsed.ingest && typeof parsed.ingest === 'object') {
              const ing = parsed.ingest as {
                pending?: number;
                processing?: number;
                failed?: number;
                ready?: number;
                total?: number;
              };
              const pend = (ing.pending ?? 0) + (ing.processing ?? 0);
              if (pend > 0) {
                toast(`Still indexing ${pend} file(s)…`, { duration: 4000 });
              }
              if ((ing.failed ?? 0) > 0) {
                toast.error(`${ing.failed} file(s) failed indexing.`);
              }
              if ((ing.total ?? 0) > 0 && (ing.ready ?? 0) === 0) {
                toast('No files are ready in this scope yet — answer may explain indexing status.', {
                  duration: 5000,
                });
              }
              continue;
            }
            const tokenChunk =
              currentEvent === 'token'
                ? typeof parsed === 'string'
                  ? parsed
                  : typeof parsed?.content === 'string'
                    ? parsed.content
                    : ''
                : '';
            if (tokenChunk) {
              accumulated += tokenChunk;
              setAnswers((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  body: accumulated,
                };
                return updated;
              });
            } else if (currentEvent === 'citations' && Array.isArray(parsed.citations)) {
              setAnswers((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  citations: parsed.citations as Citation[],
                };
                return updated;
              });
            } else if (currentEvent === 'error') {
              throw new Error((parsed.message as string) || 'stream error');
            }
          } catch {
            /* ignore malformed */
          }
        }
      }
      setAnswers((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          loading: false,
        };
        return updated;
      });
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error('Failed to answer your question.');
        setAnswers((prev) => prev.slice(0, -1));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-6 overflow-y-auto p-4">
        {answers.length === 0 && (
          <div className="py-12 text-center">
            <BookOpen className="mx-auto mb-3 h-12 w-12 text-text-secondary" />
            <p className="font-medium text-text-primary">
              Ask a question grounded in your course materials
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              Answers cite the exact page and section from your uploaded materials.
            </p>
            {!courseId && (
              <p className="mt-4 text-xs text-warning">
                Select a course in the sidebar to enable grounded answers.
              </p>
            )}
          </div>
        )}

        {answers.map((a, i) => (
          <div key={i} className="space-y-3">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-1 h-4 w-4 shrink-0 text-primary" />
              <p className="text-sm font-medium text-text-primary">{a.question}</p>
            </div>
            <div
              className={cn(
                'rounded-xl border border-border bg-bg-card p-4 text-sm leading-relaxed text-text-primary'
              )}
            >
              {a.body ? (
                <div className="whitespace-pre-wrap">
                  {renderWithCitations(a.body, a.citations, onCitationClick)}
                </div>
              ) : (
                <Skeleton className="h-4 w-48" />
              )}
            </div>
            {a.citations.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <span className="text-xs text-text-secondary">Sources:</span>
                {a.citations.map((c) => (
                  <CitationChip key={c.index} citation={c} onClick={onCitationClick} />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {fileMaterials.length > 0 && (
        <div className="max-h-40 space-y-2 overflow-y-auto border-t border-border px-4 py-3">
          <p className="text-xs font-medium text-text-secondary">Ground in these files</p>
          <ul className="space-y-1.5">
            {fileMaterials.map((m) => {
              const badge = ingestBadge(m);
              return (
                <li
                  key={m.id}
                  className="flex items-center gap-2 rounded-lg border border-border/60 bg-bg-card/50 px-2 py-1.5 text-xs"
                >
                  <input
                    type="checkbox"
                    className="rounded border-border"
                    checked={selectedMaterialIds.includes(m.id)}
                    onChange={() => toggleMaterial(m.id)}
                    aria-label={`Include ${m.title}`}
                  />
                  <span className="min-w-0 flex-1 truncate text-text-primary" title={m.title}>
                    {m.title}
                  </span>
                  <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium', badge.className)}>
                    {badge.label}
                  </span>
                  {canReingest && (m.ingestStatus === 'FAILED' || (m.ingestStatus === 'DONE' && !m.hasEmbeddings)) && (
                    <button
                      type="button"
                      className="shrink-0 rounded p-1 text-text-secondary hover:bg-border hover:text-text-primary"
                      title="Re-run indexing"
                      onClick={() => reingest(m.id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
        className="flex gap-2 border-t border-border p-4"
      >
        <input
          type="text"
          className="input flex-1"
          placeholder={
            courseId
              ? 'Ask a question grounded in your course materials…'
              : 'Select a course to enable grounded Q&A'
          }
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={streaming || !courseId}
          aria-label="Course question input"
        />
        <Button type="submit" disabled={!question.trim() || streaming || !courseId} aria-label="Ask">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
