import { z } from 'zod';

export const createThreadSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  courseId: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const createPostSchema = z.object({
  content: z.string().min(1),
});

export const threadsQuerySchema = z.object({
  tab: z.enum(['all', 'my-courses', 'following']).default('all'),
  courseId: z.string().optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

// ─── Community / Classroom Validators ──────────────────────

export const createCommunitySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  courseCode: z.string().min(2),
  session: z.string().min(1),
  department: z.string().min(1),
  university: z.string().min(1),
});

export const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1),
  fileUrl: z.string().url().optional(),
});

export const joinCommunitySchema = z.object({
  rollNumber: z.string().min(1, 'Roll number is required'),
  session: z.string().min(1, 'Session is required'),
  department: z.string().min(1, 'Department is required'),
});

export const recordAttendanceSchema = z.object({
  slotId: z.string().min(1),
  date: z.string().min(1),
  records: z.array(
    z.object({
      userId: z.string().min(1),
      present: z.boolean(),
    })
  ).min(1),
});
