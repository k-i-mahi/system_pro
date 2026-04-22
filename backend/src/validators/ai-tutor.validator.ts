import { z } from 'zod';

export const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })),
  topicId: z.string().optional(),
  courseId: z.string().optional(),
  mode: z.enum(['chat', 'quiz', 'explain']).default('chat'),
});

export const generateQuizSchema = z.object({
  topicId: z.string(),
  questionCount: z.coerce.number().int().min(1).max(20).default(5),
});

export const submitQuizSchema = z.object({
  topicId: z.string(),
  answers: z.array(z.object({
    questionId: z.string(),
    selected: z.string(),
  })),
  questions: z.array(z.object({
    id: z.string(),
    question: z.string(),
    options: z.array(z.string()),
    correct: z.string(),
  })),
  timeTaken: z.number().int().default(0),
});

export const searchResourcesSchema = z.object({
  query: z.string().min(1).max(200),
  type: z.enum(['video', 'article', 'paper', 'blog', 'website']).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});
