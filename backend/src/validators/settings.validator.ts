import { z } from 'zod';

export const updateGeneralSchema = z.object({
  language: z.string().optional(),
  timezone: z.string().optional(),
  timeFormat: z.enum(['H24', 'H12']).optional(),
  dateFormat: z.enum(['MDY', 'DMY', 'DD_MM_YYYY', 'MM_DD_YYYY', 'YYYY_MM_DD']).optional(),
});

export const updatePasswordSchema = z.object({
  oldPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8)
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number'),
});

export const updateNotificationsSchema = z.object({
  notifChat: z.boolean().optional(),
  notifNewestUpdate: z.boolean().optional(),
  notifMentorOfMonth: z.boolean().optional(),
  notifCourseOfMonth: z.boolean().optional(),
});
