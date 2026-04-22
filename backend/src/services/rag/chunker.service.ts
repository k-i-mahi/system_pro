import { env } from '../../config/env.js';

export interface RawDocument {
  text: string;
  /** Per-page text if the source is paginated (e.g. PDF). index 0 = page 1. */
  pages?: string[];
}

export interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
  page?: number;
  heading?: string;
}

const CHUNK_SIZE = env.RAG_CHUNK_SIZE;
const OVERLAP = env.RAG_CHUNK_OVERLAP;
const TOKENS_PER_CHAR = 0.25;

function approxTokens(text: string): number {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

const HEADING_REGEX = /^(#{1,6}\s+.+|[A-Z][A-Z0-9 .,\-:]{3,}$|\d+(?:\.\d+)*\s+[A-Z].{3,})$/;

/**
 * Walk text as a sequence of paragraphs, packing them into chunks of ~CHUNK_SIZE
 * tokens with OVERLAP-token overlap between neighbors. Tracks the most recent
 * heading-looking line so each chunk carries a `heading` hint for citations.
 *
 * Strategy:
 *   1. Split on blank lines → paragraph list.
 *   2. Greedy pack into chunks until token budget is hit.
 *   3. Tail OVERLAP tokens of each chunk get prepended to the next, so a span
 *      that crosses a boundary still has context on both sides.
 */
export function chunkText(text: string, startPage?: number): Chunk[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\n+/);
  const chunks: Chunk[] = [];
  let buffer = '';
  let bufferTokens = 0;
  let heading: string | undefined;

  const flush = () => {
    if (!buffer.trim()) return;
    chunks.push({
      index: chunks.length,
      content: buffer.trim(),
      tokenCount: bufferTokens,
      page: startPage,
      heading,
    });
  };

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const firstLine = trimmed.split('\n', 1)[0];
    if (HEADING_REGEX.test(firstLine) && firstLine.length < 120) {
      heading = firstLine.replace(/^#+\s+/, '').trim();
    }

    const paraTokens = approxTokens(trimmed);
    if (bufferTokens + paraTokens > CHUNK_SIZE && buffer) {
      flush();
      const tail = tailChars(buffer, OVERLAP);
      buffer = tail ? `${tail}\n\n${trimmed}` : trimmed;
      bufferTokens = approxTokens(buffer);
    } else {
      buffer = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
      bufferTokens += paraTokens;
    }
  }
  flush();
  return chunks;
}

/**
 * Chunk a paginated document (list of per-page strings), keeping page provenance
 * on each chunk. Chunks never span across pages — judges clicking a citation
 * should always land on the exact page.
 */
export function chunkPaginated(pages: string[]): Chunk[] {
  const out: Chunk[] = [];
  pages.forEach((pageText, idx) => {
    const pageChunks = chunkText(pageText, idx + 1);
    for (const c of pageChunks) {
      out.push({ ...c, index: out.length });
    }
  });
  return out;
}

export function chunkDocument(doc: RawDocument): Chunk[] {
  if (doc.pages && doc.pages.length > 0) return chunkPaginated(doc.pages);
  return chunkText(doc.text);
}

function tailChars(text: string, overlapTokens: number): string {
  const overlapChars = Math.round(overlapTokens / TOKENS_PER_CHAR);
  if (text.length <= overlapChars) return text;
  const tail = text.slice(-overlapChars);
  const firstSpace = tail.indexOf(' ');
  return firstSpace > 0 ? tail.slice(firstSpace + 1) : tail;
}
