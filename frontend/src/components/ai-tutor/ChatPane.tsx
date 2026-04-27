import { useEffect, useRef, useState } from 'react';
import { Bot, Send, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/auth.store';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';
import { StrategyBadge } from './StrategyBadge';
import { TutorTrace } from './TutorTrace';
import { useTutorSessionStore } from '@/stores/tutor-session.store';
import { cn } from '../../lib/utils';
import type { ChatMessage } from './chat-types';

export type { ChatMessage } from './chat-types';

const EMPTY_CHAT: ChatMessage[] = [];

interface Props {
  topicId?: string;
  courseId?: string;
  /** Stable key (e.g. courseId:topicId) for persisted chat history. */
  persistenceKey: string;
  systemPrimer?: string;
  initialPrompt?: string;
  emptyStateTitle?: string;
  emptyStateHint?: string;
  quickActions?: { label: string; prompt: string }[];
  endpoint?: string;
}

export function ChatPane({
  topicId,
  courseId,
  persistenceKey,
  systemPrimer,
  initialPrompt,
  emptyStateTitle = 'How can I help you study?',
  emptyStateHint = 'Ask questions, request explanations, or get practice problems.',
  quickActions = [],
  endpoint = '/api/ai-tutor/chat',
}: Props) {
  const messages = useTutorSessionStore((s) => s.byKey[persistenceKey]?.chatMessages ?? EMPTY_CHAT);
  const input = useTutorSessionStore((s) => s.byKey[persistenceKey]?.chatInput ?? '');
  const setMessages = useTutorSessionStore((s) => s.setChatMessages);
  const setChatInput = useTutorSessionStore((s) => s.setChatInput);
  const [streaming, setStreaming] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!initialPrompt || messages.length > 0 || streaming) return;
    void send(initialPrompt);
    // Intentionally react only to initialPrompt changes; messages/streaming guard duplicate sends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  async function send(text?: string) {
    const prompt = (text ?? input).trim();
    if (!prompt || streaming) return;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: prompt },
      { role: 'assistant', content: '' },
    ];
    setMessages(persistenceKey, nextMessages);
    setChatInput(persistenceKey, '');
    setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const payloadMessages = [
        ...(systemPrimer ? [{ role: 'system' as const, content: systemPrimer }] : []),
        ...nextMessages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
      ];

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${useAuthStore.getState().accessToken || ''}`,
        },
        body: JSON.stringify({
          messages: payloadMessages,
          topicId: topicId || undefined,
          courseId: courseId || undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (typeof parsed.content === 'string') {
              accumulated += parsed.content;
              setMessages(persistenceKey, (prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: accumulated,
                };
                return updated;
              });
            }
            if (parsed.strategy) {
              setMessages(persistenceKey, (prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  strategy: parsed.strategy,
                };
                return updated;
              });
            }
            if (parsed.trace) {
              setMessages(persistenceKey, (prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  trace: parsed.trace,
                };
                return updated;
              });
            }
          } catch {
            /* ignore malformed chunks */
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error('Failed to get AI response');
        setMessages(persistenceKey, (prev) => prev.slice(0, -2));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="py-12 text-center">
            <Bot className="mx-auto mb-3 h-12 w-12 text-text-secondary" />
            <p className="font-medium text-text-primary">{emptyStateTitle}</p>
            <p className="mt-1 text-sm text-text-secondary">{emptyStateHint}</p>
            {quickActions.length > 0 && (
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {quickActions.map((a) => (
                  <Button
                    key={a.label}
                    variant="outline"
                    size="sm"
                    onClick={() => send(a.prompt)}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={cn('flex gap-3', msg.role === 'user' && 'justify-end')}>
            {msg.role === 'assistant' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                <Bot className="h-4 w-4" />
              </div>
            )}
            <div className={cn('max-w-[75%] space-y-2', msg.role === 'user' && 'items-end')}>
              {msg.strategy && msg.role === 'assistant' && (
                <StrategyBadge strategy={msg.strategy} />
              )}
              <div
                className={cn(
                  'rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
                  msg.role === 'user'
                    ? 'bg-primary text-white'
                    : 'bg-bg-main text-text-primary'
                )}
              >
                {msg.content ||
                  (streaming && i === messages.length - 1 ? (
                    <Skeleton className="h-4 w-24" />
                  ) : (
                    '…'
                  ))}
              </div>
              {msg.trace && msg.trace.length > 0 && (
                <TutorTrace
                  turns={msg.trace}
                  running={streaming && i === messages.length - 1}
                />
              )}
            </div>
            {msg.role === 'user' && (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-dark text-white">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2 border-t border-border p-4"
      >
        <input
          type="text"
          className="input flex-1"
          placeholder="Ask your AI tutor…"
          value={input}
          onChange={(e) => setChatInput(persistenceKey, e.target.value)}
          disabled={streaming}
          aria-label="Chat input"
        />
        <Button type="submit" disabled={!input.trim() || streaming} aria-label="Send message">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
