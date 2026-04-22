import { z } from 'zod';

export const scanUploadSchema = z.object({});  // File validated via multer

export const bulkCreateCoursesSchema = z.object({
  courses: z.array(z.object({
    courseCode: z.string().min(2),
    courseName: z.string().min(2),
    slots: z.array(z.object({
      dayOfWeek: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
      startTime: z.string().regex(/^\d{2}:\d{2}$/),
      endTime: z.string().regex(/^\d{2}:\d{2}$/),
      type: z.enum(['CLASS', 'LAB']).default('CLASS'),
      room: z.string().optional(),
    })),
  })),
});

export const updateSlotSchema = z.object({
  dayOfWeek: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']).optional(),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  type: z.enum(['CLASS', 'LAB']).optional(),
  room: z.string().nullable().optional(),
});

export const moveSlotSchema = z.object({
  dayOfWeek: z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']),
  resolveConflicts: z.enum(['override', 'shift', 'swap']).optional(),
});
