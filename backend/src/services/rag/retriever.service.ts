import { prisma } from '../../config/database.js';
import { env } from '../../config/env.js';
import { embed } from '../ollama.service.js';
import { logger } from '../observability/logger.js';
import { ragChunksReturned, ragRetrievalHitRate } from '../observability/metrics.js';
import { vectorLiteral } from './embedding.service.js';

export interface RetrievedChunk {
  id: string;
  materialId: string;
  materialTitle: string;
  chunkIndex: number;
  content: string;
  page: number | null;
  heading: string | null;
  cosineDistance: number | null;
  bm25Rank: number | null;
  vectorRank: number | null;
  fusedScore: number;
}

export interface RetrievalScope {
  /** Restrict to a specific course (preferred). */
  courseId?: string;
  /** Restrict to one topic within a course. */
  topicId?: string;
  /** Restrict to an explicit material allowlist. */
  materialIds?: string[];
  /** User who owns/has access to the material — enforces RLS at the app layer. */
  userId?: string;
}

const CANDIDATE_LIMIT = 20;
const RRF_K = 60; // Classical RRF smoothing constant.

/**
 * Hybrid retrieval:
 *   - BM25 top-K via tsvector + ts_rank_cd
 *   - cosine top-K via pgvector HNSW
 *   - fused via Reciprocal Rank Fusion: score = Σ 1 / (RRF_K + rank_i)
 *
 * Returns up to `topK` chunks with per-signal ranks for observability.
 */
export async function retrieveChunks(
  query: string,
  scope: RetrievalScope,
  topK: number = env.RAG_TOP_K
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const materialIds = await resolveMaterialScope(scope);
  if (materialIds !== null && materialIds.length === 0) {
    logger.debug({ scope }, 'rag.retrieve: no materials in scope');
    return [];
  }

  const [queryVec] = await embed(trimmed);
  const vecLiteral = vectorLiteral(queryVec);

  const [vectorHits, bm25Hits] = await Promise.all([
    vectorSearch(vecLiteral, materialIds, CANDIDATE_LIMIT),
    bm25Search(trimmed, materialIds, CANDIDATE_LIMIT),
  ]);

  const fused = reciprocalRankFusion(vectorHits, bm25Hits).slice(0, topK);
  if (scope.courseId) {
    ragRetrievalHitRate.set({ course: scope.courseId }, fused.length > 0 ? 1 : 0);
  }
  ragChunksReturned.observe({ route: 'ask-course' }, fused.length);

  return fused;
}

async function resolveMaterialScope(scope: RetrievalScope): Promise<string[] | null> {
  if (scope.materialIds && scope.materialIds.length > 0) return scope.materialIds;

  const where: Record<string, unknown> = { hasEmbeddings: true };
  if (scope.courseId) where.courseId = scope.courseId;
  if (scope.topicId) where.topicId = scope.topicId;
  if (scope.userId) where.userId = scope.userId;

  if (Object.keys(where).length === 1) return null; // no scope → global

  const mats = await prisma.material.findMany({ where, select: { id: true } });
  return mats.map((m) => m.id);
}

interface RawVectorRow {
  id: string;
  materialId: string;
  materialTitle: string;
  chunkIndex: number;
  content: string;
  page: number | null;
  heading: string | null;
  distance: number;
}

async function vectorSearch(
  vec: string,
  materialIds: string[] | null,
  limit: number
): Promise<RawVectorRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [vec];
  if (materialIds) {
    params.push(materialIds);
    clauses.push(`e."materialId" = ANY($${params.length}::text[])`);
  }
  const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const sql = `
    SELECT
      e."id"           AS "id",
      e."materialId"   AS "materialId",
      m."title"        AS "materialTitle",
      e."chunkIndex"   AS "chunkIndex",
      e."content"      AS "content",
      e."page"         AS "page",
      e."heading"      AS "heading",
      (e."embedding" <=> $1::vector) AS "distance"
    FROM "Embedding" e
    JOIN "Material" m ON m."id" = e."materialId"
    ${whereSql}
    ORDER BY e."embedding" <=> $1::vector
    LIMIT ${Number(limit)}
  `;

  return (await prisma.$queryRawUnsafe(sql, ...params)) as RawVectorRow[];
}

interface RawBm25Row {
  id: string;
  materialId: string;
  materialTitle: string;
  chunkIndex: number;
  content: string;
  page: number | null;
  heading: string | null;
  rank: number;
}

async function bm25Search(
  query: string,
  materialIds: string[] | null,
  limit: number
): Promise<RawBm25Row[]> {
  const clauses: string[] = [`e."tsv" @@ websearch_to_tsquery('english', $1)`];
  const params: unknown[] = [query];
  if (materialIds) {
    params.push(materialIds);
    clauses.push(`e."materialId" = ANY($${params.length}::text[])`);
  }

  const sql = `
    SELECT
      e."id"           AS "id",
      e."materialId"   AS "materialId",
      m."title"        AS "materialTitle",
      e."chunkIndex"   AS "chunkIndex",
      e."content"      AS "content",
      e."page"         AS "page",
      e."heading"      AS "heading",
      ts_rank_cd(e."tsv", websearch_to_tsquery('english', $1)) AS "rank"
    FROM "Embedding" e
    JOIN "Material" m ON m."id" = e."materialId"
    WHERE ${clauses.join(' AND ')}
    ORDER BY "rank" DESC
    LIMIT ${Number(limit)}
  `;

  return (await prisma.$queryRawUnsafe(sql, ...params)) as RawBm25Row[];
}

function reciprocalRankFusion(
  vectorHits: RawVectorRow[],
  bm25Hits: RawBm25Row[]
): RetrievedChunk[] {
  const acc = new Map<string, RetrievedChunk>();

  vectorHits.forEach((row, idx) => {
    const rank = idx + 1;
    acc.set(row.id, {
      id: row.id,
      materialId: row.materialId,
      materialTitle: row.materialTitle,
      chunkIndex: row.chunkIndex,
      content: row.content,
      page: row.page,
      heading: row.heading,
      cosineDistance: Number(row.distance),
      bm25Rank: null,
      vectorRank: rank,
      fusedScore: 1 / (RRF_K + rank),
    });
  });

  bm25Hits.forEach((row, idx) => {
    const rank = idx + 1;
    const existing = acc.get(row.id);
    if (existing) {
      existing.bm25Rank = rank;
      existing.fusedScore += 1 / (RRF_K + rank);
    } else {
      acc.set(row.id, {
        id: row.id,
        materialId: row.materialId,
        materialTitle: row.materialTitle,
        chunkIndex: row.chunkIndex,
        content: row.content,
        page: row.page,
        heading: row.heading,
        cosineDistance: null,
        bm25Rank: rank,
        vectorRank: null,
        fusedScore: 1 / (RRF_K + rank),
      });
    }
  });

  return Array.from(acc.values()).sort((a, b) => b.fusedScore - a.fusedScore);
}
