export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  type: 'video' | 'article' | 'paper' | 'blog' | 'website';
}

const HEADERS = {
  'User-Agent': 'StudyBot/1.0 (Educational App)',
  'Accept': 'application/json',
};

/**
 * Search Wikipedia for encyclopedic articles.
 */
async function searchWikipedia(query: string, limit: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srlimit: String(limit),
    format: 'json',
    origin: '*',
  });

  try {
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, { headers: HEADERS });
    if (!res.ok) return [];
    const data = await res.json() as { query?: { search?: Array<{ title: string; snippet: string; pageid: number }> } };
    return (data.query?.search || []).map((item) => ({
      title: item.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
      snippet: item.snippet.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&'),
      type: 'article' as const,
    }));
  } catch (err) {
    console.error('[search] Wikipedia error:', err);
    return [];
  }
}

/**
 * Search StackOverflow for Q&A results.
 */
async function searchStackOverflow(query: string, limit: number): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    order: 'desc',
    sort: 'relevance',
    q: query,
    site: 'stackoverflow',
    pagesize: String(limit),
    filter: 'default',
    answers: '1',
  });

  try {
    const res = await fetch(`https://api.stackexchange.com/2.3/search/advanced?${params}`, { headers: HEADERS });
    if (!res.ok) return [];
    const data = await res.json() as { items?: Array<{ title: string; link: string; tags: string[] }> };
    return (data.items || []).map((item) => ({
      title: item.title.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'"),
      url: item.link,
      snippet: `Tags: ${item.tags.slice(0, 5).join(', ')}`,
      type: 'article' as const,
    }));
  } catch (err) {
    console.error('[search] StackOverflow error:', err);
    return [];
  }
}

/**
 * Search Hacker News (via Algolia API) for blog posts / tutorials / articles.
 */
async function searchHackerNews(query: string, limit: number): Promise<SearchResult[]> {
  try {
    const res = await fetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`,
      { headers: HEADERS }
    );
    if (!res.ok) return [];
    const data = await res.json() as { hits?: Array<{ title: string; url: string; story_text?: string; objectID: string; num_comments?: number }> };
    return (data.hits || [])
      .filter((item) => item.url) // only items with external URLs
      .slice(0, limit)
      .map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.story_text?.replace(/<[^>]+>/g, '').substring(0, 150) || `${item.num_comments || 0} comments on Hacker News`,
        type: 'blog' as const,
      }));
  } catch (err) {
    console.error('[search] HackerNews error:', err);
    return [];
  }
}

/**
 * Build YouTube search link results (no API key needed — we just link to YouTube search).
 */
function buildYouTubeResults(query: string): SearchResult[] {
  return [{
    title: `YouTube: "${query}" tutorials`,
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' tutorial')}`,
    snippet: 'Search YouTube for video tutorials on this topic',
    type: 'video' as const,
  }];
}

/**
 * Main search function — aggregates results from multiple free APIs.
 */
export async function searchWeb(
  query: string,
  type?: string,
  limit = 10
): Promise<SearchResult[]> {
  const perSource = Math.max(3, Math.ceil(limit / 3));

  if (type === 'video') {
    return buildYouTubeResults(query);
  }

  if (type === 'blog') {
    return searchHackerNews(query, limit);
  }

  if (type === 'paper' || type === 'article') {
    const [wiki, so] = await Promise.all([
      searchWikipedia(query, perSource),
      searchStackOverflow(query, perSource),
    ]);
    return [...wiki, ...so].slice(0, limit);
  }

  // "All" — query everything in parallel
  const [wiki, so, hn] = await Promise.all([
    searchWikipedia(query, perSource),
    searchStackOverflow(query, perSource),
    searchHackerNews(query, perSource),
  ]);

  const youtube = buildYouTubeResults(query);
  return [...youtube, ...wiki, ...hn, ...so].slice(0, limit);
}
