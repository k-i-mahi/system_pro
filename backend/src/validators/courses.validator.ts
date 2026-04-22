import { z } from 'zod';

export const createTopicSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  weekNumber: z.number().int().optional(),
  sessionDate: z.string().datetime().optional(),
  orderIndex: z.number().int().optional(),
  status: z.enum(['NOT_STARTED', 'IN_PROGRESS', 'DONE']).optional(),
});

export const updateTopicSchema = createTopicSchema.partial();

export const reorderTopicsSchema = z.object({
  topicIds: z.array(z.string()),
});

export const coursesQuerySchema = z.object({
  search: z.string().optional(),
  level: z.string().optional(),
  category: z.string().optional(),
  sort: z.enum(['az', 'za', 'popular']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});
