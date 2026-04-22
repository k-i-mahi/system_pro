import { Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { extractTextFromFile } from '../services/ocr.service.js';
import { logger } from '../services/observability/logger.js';
import type { OcrJobData } from './queues.js';
import fs from 'fs';

const connection = { host: redis.options.host!, port: redis.options.port! };

/**
 * Dedicated OCR queue for the `accurate` path, which can take tens of seconds
 * per page. Runs in parallel with the ingest worker so a slow OCR never blocks
 * material uploads or chunk embedding for other files.
 */
const worker = new Worker<OcrJobData>(
  'ocr',
  async (job) => {
    const { materialId, filePath, quality } = job.data;
    try {
      const result = await extractTextFromFile(filePath, quality);
      logger.info(
        { materialId, engine: result.engine, length: result.text.length },
        'ocr.done'
      );
      return { text: result.text, engine: result.engine, pages: result.pages };
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlink(filePath, () => {});
      }
    }
  },
  { connection, concurrency: 1 }
);

worker.on('failed', (job, err) => {
  logger.error({ err: err.message, jobId: job?.id }, 'ocr job failed');
});

export default worker;
