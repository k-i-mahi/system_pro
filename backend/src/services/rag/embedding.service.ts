import { randomUUID } from 'crypto';
import { prisma } from '../../config/database.js';
import { embed } from '../ollama.service.js';
import { logger } from '../observability/logger.js';
import type { Chunk } from './chunker.service.js';

const BATCH_SIZE = 16;

/**
 * Persist a batch of chunks for a material. Uses pgvector syntax via
 * $executeRawUnsafe because Prisma cannot parameterize the `vector` type yet.
 * Vectors are written in the Postgres `[x,y,z]` literal form.
 *
 * The tsvector column is populated by the DB trigger `embedding_tsv_update`
 * defined in the migration, so we don't need to compute it here.
 */
export async function embedAndStoreChunks(
  materialId: string,
  chunks: Chunk[]
): Promise<{ stored: number }> {
  if (chunks.length === 0) return { stored: 0 };

  let stored = 0;
  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await embed(batch.map((c) => c.content));

    for (let j = 0; j < batch.length; j++) {
      const chunk = batch[j];
      const vec = vectors[j];
      if (!vec || vec.length === 0) {
        logger.warn({ materialId, chunkIndex: chunk.index }, 'empty embedding skipped');
        continue;
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Embedding" ("id","materialId","chunkIndex","content","page","heading","tokenCount","embedding")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::vector)`,
        randomUUID(),
        materialId,
        chunk.index,
        chunk.content,
        chunk.page ?? null,
        chunk.heading ?? null,
        chunk.tokenCount,
        vectorLiteral(vec)
      );
      stored++;
    }
  }
  return { stored };
}

/**
 * Delete all existing embeddings for a material — used when re-ingesting.
 */
export async function clearEmbeddingsForMaterial(materialId: string): Promise<number> {
  const result = await prisma.embedding.deleteMany({ where: { materialId } });
  return result.count;
}

export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}
