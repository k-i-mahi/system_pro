import { useEffect, useRef, useState } from 'react';
import { BookOpen, Send, Sparkles } from 'lucide-react';
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

interface Props {
  courseId?: string;
  topicId?: string;
  onCitationClick?: (c: Citation) => void;
}

export function AskCoursePane({ courseId, topicId, onCitationClick }: Props) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [answers]);

  useEffect(() => () => abortRef.current?.abort(), []);

  async function ask() {
    const q = question.trim();
    if (!q || streaming) return;
    if (!courseId) {
      toast.error('Select a course to ground your question.');
      return;
    }

    setAnswers((prev) => [
      ...prev,
      { question: q, body: '', citations: [], loading: true },
    ]);
    setQuestion('');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/ai-tutor/ask-course', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAuthStore.getState().accessToken || ''}`,
        },
        body: JSON.stringify({ question: q, courseId, topicId, stream: true }),
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
            const parsed = JSON.parse(data);
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
                  citations: parsed.citations,
                };
                return updated;
              });
            } else if (currentEvent === 'error') {
              throw new Error(parsed.message || 'stream error');
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
                  <CitationChip
                    key={c.index}
                    citation={c}
                    onClick={onCitationClick}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

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
        <Button
          type="submit"
          disabled={!question.trim() || streaming || !courseId}
          aria-label="Ask"
        >
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
