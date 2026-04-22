import { Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { createNotification } from '../services/notification.service.js';

const connection = { host: redis.options.host!, port: redis.options.port! };

const worker = new Worker(
  'notifications',
  async (job) => {
    const { userId, type, title, body, link } = job.data;
    await createNotification({ userId, type, title, body, link });
    console.log(`Notification sent to ${userId}: ${title}`);
  },
  { connection, concurrency: 5 }
);

worker.on('failed', (job, err) => {
  console.error(`Notification job ${job?.id} failed:`, err.message);
});

export default worker;
