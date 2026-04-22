import { Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';

const connection = { host: redis.options.host!, port: redis.options.port! };

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
});

const worker = new Worker(
  'emails',
  async (job) => {
    const { to, subject, html } = job.data;
    await transporter.sendMail({
      from: `"Cognitive Copilot" <${env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`Email sent to ${to}: ${subject}`);
  },
  { connection, concurrency: 3 }
);

worker.on('failed', (job, err) => {
  console.error(`Email job ${job?.id} failed:`, err.message);
});

export default worker;
