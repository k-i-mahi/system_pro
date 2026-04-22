import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BookOpen,
  ExternalLink,
  GraduationCap,
  Globe,
  MessageSquare,
  Search,
  Video,
} from 'lucide-react';
import api from '@/lib/api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  type: 'video' | 'article' | 'paper' | 'blog' | 'website';
}

const TYPE_META: Record<
  SearchResult['type'],
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  video: { label: 'Video', icon: Video, color: 'text-red-500' },
  article: { label: 'Article', icon: Globe, color: 'text-blue-500' },
  paper: { label: 'Paper', icon: GraduationCap, color: 'text-purple-500' },
  blog: { label: 'Blog', icon: MessageSquare, color: 'text-green-500' },
  website: { label: 'Website', icon: Globe, color: 'text-text-secondary' },
};

const FILTER_TYPES = [
  { key: '', label: 'All' },
  { key: 'video', label: 'Video' },
  { key: 'article', label: 'Article' },
  { key: 'paper', label: 'Paper' },
  { key: 'blog', label: 'Blog' },
] as const;

interface Props {
  topicTitle?: string;
}

export function ResourceSuggestPane({ topicTitle }: Props) {
  const [query, setQuery] = useState(topicTitle ?? '');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const { data: results = [], isFetching } = useQuery<SearchResult[]>({
    queryKey: ['search-resources', submittedQuery, typeFilter],
    queryFn: () => {
      const params = new URLSearchParams({ query: submittedQuery });
      if (typeFilter) params.set('type', typeFilter);
      return api
        .get(`/ai-tutor/search-resources?${params}`)
        .then((r) => r.data.data as SearchResult[]);
    },
    enabled: !!submittedQuery,
    staleTime: 5 * 60_000,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) setSubmittedQuery(q);
  }

  // On first render, if a topic title is passed, auto-populate query field
  // so the student just presses Search.

  return (
    <div className="flex h-full flex-col">
      <header className="space-y-3 border-b border-border p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
            <input
              type="text"
              className="input w-full pl-9"
              placeholder={
                topicTitle
                  ? `Search for resources on "${topicTitle}"…`
                  : 'Search for learning resources…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Resource search query"
            />
          </div>
          <Button type="submit" disabled={!query.trim() || isFetching}>
            {isFetching ? 'Searching…' : 'Search'}
          </Button>
        </form>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by type">
          {FILTER_TYPES.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setTypeFilter(f.key);
                if (submittedQuery) setSubmittedQuery(submittedQuery); // retrigger query
              }}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                typeFilter === f.key
                  ? 'bg-primary text-white'
                  : 'bg-bg-main text-text-secondary hover:text-text-primary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {!submittedQuery && (
          <div className="py-12 text-center">
            <Globe className="mx-auto mb-3 h-12 w-12 text-text-secondary" />
            <p className="font-medium text-text-primary">Discover learning resources</p>
            <p className="mt-1 text-sm text-text-secondary">
              Searches Wikipedia, Stack Overflow, Hacker News, and YouTube simultaneously.
            </p>
            {topicTitle && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  setQuery(topicTitle);
                  setSubmittedQuery(topicTitle);
                }}
              >
                Search for "{topicTitle}"
              </Button>
            )}
          </div>
        )}

        {isFetching && (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        )}

        {!isFetching && submittedQuery && results.length === 0 && (
          <div className="py-12 text-center">
            <Search className="mx-auto mb-3 h-12 w-12 text-text-secondary" />
            <p className="font-medium text-text-primary">No results found</p>
            <p className="mt-1 text-sm text-text-secondary">
              Try a different query or remove the type filter.
            </p>
          </div>
        )}

        {!isFetching && results.length > 0 && (
          <div className="space-y-3">
            {results.map((r, i) => {
              const meta = TYPE_META[r.type] ?? TYPE_META.website;
              const Icon = meta.icon;
              let hostname = '';
              try {
                hostname = new URL(r.url).hostname;
              } catch {}

              return (
                <a
                  key={i}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 rounded-xl border border-border bg-bg-card p-4 transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <Icon
                    className={`mt-0.5 h-5 w-5 shrink-0 ${meta.color}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-primary">
                        {r.title}
                      </p>
                      <ExternalLink className="h-3 w-3 shrink-0 text-text-secondary" />
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                      {r.snippet}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="secondary">{meta.label}</Badge>
                      {hostname && (
                        <span className="truncate text-[11px] text-text-secondary">
                          {hostname}
                        </span>
                      )}
                    </div>
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
