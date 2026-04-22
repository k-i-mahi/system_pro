import { Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { createNotification } from '../services/notification.service.js';
import type { DayOfWeek } from '@prisma/client';

const connection = { host: redis.options.host!, port: redis.options.port! };

const DAY_MAP: Record<number, DayOfWeek> = {
  0: 'SUN',
  1: 'MON',
  2: 'TUE',
  3: 'WED',
  4: 'THU',
  5: 'FRI',
  6: 'SAT',
};

/**
 * Convert "HH:mm" to total minutes since midnight.
 */
function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const worker = new Worker(
  'material-prompts',
  async () => {
    const now = new Date();
    const today = DAY_MAP[now.getDay()];
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    // Find slots that ended recently.
    // Wider window prevents missed prompts when the scheduler is delayed.
    const slots = await prisma.scheduleSlot.findMany({
      where: { dayOfWeek: today },
      include: { course: true },
    });

    const recentlyEnded = slots.filter((slot) => {
      const endMin = toMinutes(slot.endTime);
      return endMin > nowMinutes - 10 && endMin <= nowMinutes;
    });

    const dateKey = now.toISOString().slice(0, 10); // "YYYY-MM-DD"

    for (const slot of recentlyEnded) {
      // Find students enrolled in this course.
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId: slot.courseId },
        select: { userId: true },
      });

      // Find tutors for this course community (if present).
      const tutorMembers = await prisma.communityMember.findMany({
        where: {
          role: 'TUTOR',
          community: { courseId: slot.courseId },
        },
        select: { userId: true },
      });

      const recipientIds = Array.from(
        new Set([...enrollments.map((e) => e.userId), ...tutorMembers.map((m) => m.userId)])
      );

      // Send notification to each relevant user.
      const label = slot.type === 'LAB' ? 'lab' : 'class';
      await Promise.all(
        recipientIds.map(async (userId) => {
          const dedupKey = `material-prompt:${dateKey}:${slot.id}:${userId}`;
          const already = await redis.get(dedupKey);
          if (already) return;

          await createNotification({
            userId,
            type: 'MATERIAL_UPLOAD_PROMPT',
            title: 'Upload your class material',
            body: `Your ${slot.course.courseCode} ${label} just ended. Upload your notes or materials!`,
            metadata: { courseId: slot.courseId, slotId: slot.id, date: dateKey },
          });

          await redis.set(dedupKey, '1', 'EX', 86400);
        })
      );
    }
  },
  { connection, concurrency: 1 }
);

worker.on('failed', (job, err) => {
  console.error(`Material prompt job ${job?.id} failed:`, err.message);
});

export default worker;
