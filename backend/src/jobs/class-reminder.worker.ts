import { Worker } from 'bullmq';
import { redis } from '../config/redis.js';
import { prisma } from '../config/database.js';
import { createNotification } from '../services/notification.service.js';
import type { DayOfWeek, NotificationType } from '@prisma/client';

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

const REMINDER_LEAD_MINUTES = 15;

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const worker = new Worker(
  'class-reminders',
  async () => {
    const now = new Date();
    const today = DAY_MAP[now.getDay()];
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const slots = await prisma.scheduleSlot.findMany({
      where: { dayOfWeek: today },
      include: { course: true },
    });

    const upcoming = slots.filter((slot) => {
      const startMin = toMinutes(slot.startTime);
      return startMin >= nowMinutes && startMin <= nowMinutes + REMINDER_LEAD_MINUTES;
    });

    const dateKey = now.toISOString().slice(0, 10);

    for (const slot of upcoming) {
      const enrollments = await prisma.enrollment.findMany({
        where: { courseId: slot.courseId },
        select: { userId: true },
      });

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

      const reminderType: NotificationType = slot.type === 'LAB' ? 'LAB_REMINDER' : 'CLASS_REMINDER';
      const sessionLabel = slot.type === 'LAB' ? 'lab' : 'class';
      const roomText = slot.room ? ` in ${slot.room}` : '';

      await Promise.all(
        recipientIds.map(async (userId) => {
          const dedupKey = `class-reminder:${dateKey}:${slot.id}:${userId}`;
          const already = await redis.get(dedupKey);
          if (already) return;

          await createNotification({
            userId,
            type: reminderType,
            title: `${slot.course.courseCode} starts soon`,
            body: `Your ${sessionLabel} starts at ${slot.startTime}${roomText}. Be ready.`,
            metadata: { courseId: slot.courseId, slotId: slot.id, date: dateKey, startTime: slot.startTime },
          });

          await redis.set(dedupKey, '1', 'EX', 86400);
        })
      );
    }
  },
  { connection, concurrency: 1 }
);

worker.on('failed', (job, err) => {
  console.error(`Class reminder job ${job?.id} failed:`, err.message);
});

export default worker;
