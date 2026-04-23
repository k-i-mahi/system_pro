from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Literal

import httpx

logger = logging.getLogger(__name__)

SearchType = Literal["video", "article", "paper", "blog", "website"]

_HEADERS = {
    "User-Agent": "StudyBot/1.0 (Educational App)",
    "Accept": "application/json",
}


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    type: SearchType


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", "", text)
    return text.replace("&quot;", '"').replace("&amp;", "&").replace("&#39;", "'")


async def _search_wikipedia(query: str, limit: int) -> list[SearchResult]:
    params = {
        "action": "query",
        "list": "search",
        "srsearch": query,
        "srlimit": str(limit),
        "format": "json",
        "origin": "*",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_HEADERS) as client:
            r = await client.get("https://en.wikipedia.org/w/api.php", params=params)
            r.raise_for_status()
            data = r.json()
            items = data.get("query", {}).get("search", [])
            return [
                SearchResult(
                    title=item["title"],
                    url=f"https://en.wikipedia.org/wiki/{item['title'].replace(' ', '_')}",
                    snippet=_strip_html(item.get("snippet", "")),
                    type="article",
                )
                for item in items
            ]
    except Exception as exc:
        logger.warning("Wikipedia search error: %s", exc)
        return []


async def _search_stackoverflow(query: str, limit: int) -> list[SearchResult]:
    params = {
        "order": "desc",
        "sort": "relevance",
        "q": query,
        "site": "stackoverflow",
        "pagesize": str(limit),
        "filter": "default",
        "answers": "1",
    }
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_HEADERS) as client:
            r = await client.get("https://api.stackexchange.com/2.3/search/advanced", params=params)
            r.raise_for_status()
            items = r.json().get("items", [])
            return [
                SearchResult(
                    title=_strip_html(item["title"]),
                    url=item["link"],
                    snippet=f"Tags: {', '.join(item.get('tags', [])[:5])}",
                    type="article",
                )
                for item in items
            ]
    except Exception as exc:
        logger.warning("StackOverflow search error: %s", exc)
        return []


async def _search_hacker_news(query: str, limit: int) -> list[SearchResult]:
    try:
        async with httpx.AsyncClient(timeout=10.0, headers=_HEADERS) as client:
            r = await client.get(
                f"https://hn.algolia.com/api/v1/search",
                params={"query": query, "tags": "story", "hitsPerPage": str(limit)},
            )
            r.raise_for_status()
            hits = [h for h in r.json().get("hits", []) if h.get("url")][:limit]
            return [
                SearchResult(
                    title=item["title"],
                    url=item["url"],
                    snippet=_strip_html(item.get("story_text") or "")[:150] or f"{item.get('num_comments', 0)} comments on Hacker News",
                    type="blog",
                )
                for item in hits
            ]
    except Exception as exc:
        logger.warning("HackerNews search error: %s", exc)
        return []


def _youtube_results(query: str) -> list[SearchResult]:
    from urllib.parse import quote_plus
    return [
        SearchResult(
            title=f'YouTube: "{query}" tutorials',
            url=f"https://www.youtube.com/results?search_query={quote_plus(query + ' tutorial')}",
            snippet="Search YouTube for video tutorials on this topic",
            type="video",
        )
    ]


async def search_web(query: str, type: str | None = None, limit: int = 10) -> list[dict]:
    per_source = max(3, (limit + 2) // 3)

    if type == "video":
        results = _youtube_results(query)
    elif type == "blog":
        results = await _search_hacker_news(query, limit)
    elif type in ("paper", "article"):
        wiki, so = await asyncio.gather(
            _search_wikipedia(query, per_source),
            _search_stackoverflow(query, per_source),
        )
        results = (wiki + so)[:limit]
    else:
        wiki, so, hn = await asyncio.gather(
            _search_wikipedia(query, per_source),
            _search_stackoverflow(query, per_source),
            _search_hacker_news(query, per_source),
        )
        results = (_youtube_results(query) + wiki + hn + so)[:limit]

    return [{"title": r.title, "url": r.url, "snippet": r.snippet, "type": r.type} for r in results]
