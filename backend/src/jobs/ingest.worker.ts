import { Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { extractTextFromFile, type OcrQuality } from '../services/ocr.service.js';
import { chunkDocument } from '../services/rag/chunker.service.js';
import {
  clearEmbeddingsForMaterial,
  embedAndStoreChunks,
} from '../services/rag/embedding.service.js';
import { logger } from '../services/observability/logger.js';
import { ingestJobDuration } from '../services/observability/metrics.js';
import type { IngestJobData } from './queues.js';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { request } from 'undici';

const connection = { host: redis.options.host!, port: redis.options.port! };

/**
 * Download a remote file (Cloudinary, etc.) to a temp path so OCR/Tesseract can
 * read it from disk. Returns the temp path, which the caller must unlink.
 */
async function downloadToTemp(url: string, preferredExt?: string): Promise<string> {
  const ext = preferredExt || path.extname(new URL(url).pathname) || '.bin';
  const tmp = path.join(os.tmpdir(), `copilot-ingest-${randomUUID()}${ext}`);
  const { statusCode, body } = await request(url);
  if (statusCode >= 400) {
    throw new Error(`Download failed (${statusCode}) for ${url}`);
  }
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createWriteStream(tmp);
    body.pipe(stream);
    body.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', () => resolve());
  });
  return tmp;
}

function extensionForFileType(fileType: string): string {
  switch (fileType.toUpperCase()) {
    case 'PDF':
      return '.pdf';
    case 'DOCX':
      return '.docx';
    case 'IMAGE':
      return '.png';
    default:
      return '';
  }
}

const worker = new Worker<IngestJobData>(
  'material-ingest',
  async (job) => {
    const { materialId, quality, reingest } = job.data;
    const started = process.hrtime.bigint();
    let stage = 'load';
    let tempPath: string | null = null;

    await prisma.material.update({
      where: { id: materialId },
      data: { ingestStatus: 'PROCESSING', ingestError: null },
    });

    try {
      const material = await prisma.material.findUnique({ where: { id: materialId } });
      if (!material) throw new Error(`Material ${materialId} not found`);
      if (!material.fileUrl) throw new Error(`Material ${materialId} has no fileUrl`);
      if (material.fileType === 'LINK') {
        await prisma.material.update({
          where: { id: materialId },
          data: { ingestStatus: 'DONE', hasEmbeddings: false, chunkCount: 0 },
        });
        logger.info({ materialId }, 'ingest.skipped-link');
        return;
      }

      stage = 'download';
      tempPath = await downloadToTemp(material.fileUrl, extensionForFileType(material.fileType));

      stage = 'extract';
      const chosenQuality: OcrQuality =
        quality ?? (material.ocrQuality === 'ACCURATE' ? 'accurate' : 'fast');
      const ocr = await extractTextFromFile(tempPath, chosenQuality);

      stage = 'chunk';
      const chunks = chunkDocument({ text: ocr.text, pages: ocr.pages });
      if (chunks.length === 0) {
        throw new Error('No text extracted — material may be empty or unreadable');
      }

      stage = 'embed';
      if (reingest) await clearEmbeddingsForMaterial(materialId);
      const { stored } = await embedAndStoreChunks(materialId, chunks);

      stage = 'finalize';
      await prisma.material.update({
        where: { id: materialId },
        data: {
          ingestStatus: 'DONE',
          hasEmbeddings: stored > 0,
          chunkCount: stored,
          ingestError: null,
        },
      });

      const durSec = Number((process.hrtime.bigint() - started) / 1_000_000n) / 1000;
      ingestJobDuration.observe({ stage: 'total', status: 'ok' }, durSec);
      logger.info(
        { materialId, chunks: stored, engine: ocr.engine, durSec: durSec.toFixed(1) },
        'ingest.done'
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.material.update({
        where: { id: materialId },
        data: { ingestStatus: 'FAILED', ingestError: message.slice(0, 500) },
      });
      const durSec = Number((process.hrtime.bigint() - started) / 1_000_000n) / 1000;
      ingestJobDuration.observe({ stage, status: 'error' }, durSec);
      logger.error({ err: message, materialId, stage }, 'ingest.failed');
      throw err;
    } finally {
      if (tempPath) {
        fs.unlink(tempPath, () => {});
      }
    }
  },
  { connection, concurrency: 2 }
);

worker.on('failed', (job, err) => {
  logger.error({ err: err.message, jobId: job?.id }, 'ingest job failed');
});

export default worker;
