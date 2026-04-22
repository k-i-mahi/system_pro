import { z } from 'zod';

export const updateProfileSchema = z.object({
  name: z.string().min(2).optional(),
  universityName: z.string().min(3).optional(),
  bio: z.string().max(500).optional(),
  phone: z.string().max(20).optional(),
});

export const attendanceSchema = z.object({
  slotId: z.string(),
  date: z.string().datetime(),
  present: z.boolean(),
});

export const ctScoreSchema = z.object({
  enrollmentId: z.string(),
  ctScore1: z.number().min(0).max(100).optional(),
  ctScore2: z.number().min(0).max(100).optional(),
  ctScore3: z.number().min(0).max(100).optional(),
});

export const labScoreSchema = z.object({
  enrollmentId: z.string(),
  labScore: z.number().min(0).max(100),
});
