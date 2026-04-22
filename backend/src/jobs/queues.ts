import { Queue } from 'bullmq';
import { redis } from '../config/redis.js';

const connection = { host: redis.options.host!, port: redis.options.port! };

export const notificationQueue = new Queue('notifications', { connection });
export const emailQueue = new Queue('emails', { connection });
export const materialPromptQueue = new Queue('material-prompts', { connection });
export const classReminderQueue = new Queue('class-reminders', { connection });
export const ingestQueue = new Queue('material-ingest', { connection });
export const ocrQueue = new Queue('ocr', { connection });

export interface IngestJobData {
  materialId: string;
  userId: string;
  quality?: 'fast' | 'accurate';
  reingest?: boolean;
}

export async function enqueueIngest(data: IngestJobData) {
  await ingestQueue.add('ingest-material', data, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  });
}

export interface OcrJobData {
  materialId: string;
  filePath: string;
  quality: 'fast' | 'accurate';
  userId: string;
}

export async function enqueueOcr(data: OcrJobData) {
  await ocrQueue.add('ocr-material', data, {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 100 },
  });
}

export async function enqueueNotification(data: {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
}) {
  await notificationQueue.add('send-notification', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

export async function enqueueEmail(data: {
  to: string;
  subject: string;
  html: string;
}) {
  await emailQueue.add('send-email', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });
}

export async function startMaterialPromptScheduler() {
  // Remove any stale repeatable jobs, then add a fresh one
  const existing = await materialPromptQueue.getRepeatableJobs();
  for (const job of existing) {
    await materialPromptQueue.removeRepeatableByKey(job.key);
  }

  await materialPromptQueue.add(
    'check-ended-classes',
    {},
    { repeat: { every: 5 * 60 * 1000 } } // every 5 minutes
  );

  console.log('✓ Material-upload prompt scheduler started (every 5 min)');
}

export async function startClassReminderScheduler() {
  // Remove any stale repeatable jobs, then add a fresh one
  const existing = await classReminderQueue.getRepeatableJobs();
  for (const job of existing) {
    await classReminderQueue.removeRepeatableByKey(job.key);
  }

  await classReminderQueue.add(
    'check-upcoming-classes',
    {},
    { repeat: { every: 60 * 1000 } } // every 1 minute
  );

  console.log('✓ Class reminder scheduler started (every 1 min)');
}
