import type { TutorMode } from '@/components/ai-tutor';

export function normalizeTutorMode(value: string | null | undefined): TutorMode {
  if (value === 'exam') return 'quiz';
  if (value === 'ask') return 'ask-course';
  if (value === 'explain') return 'chat';
  if (value === 'chat' || value === 'ask-course' || value === 'quiz' || value === 'resources') {
    return value;
  }
  return 'chat';
}
