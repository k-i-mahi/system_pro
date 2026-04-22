import { chatCompletionStructured } from '../../ollama.service.js';
import type { AgentTool } from './types.js';

const SCHEMA = {
  type: 'object',
  properties: {
    question: { type: 'string' },
    options: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
    correct: { type: 'string', enum: ['A', 'B', 'C', 'D'] },
    explanation: { type: 'string' },
    difficulty: { type: 'integer', minimum: 1, maximum: 5 },
  },
  required: ['question', 'options', 'correct', 'explanation'],
};

interface GeneratedQuestion {
  question: string;
  options: string[];
  correct: string;
  explanation: string;
  difficulty?: number;
}

export const generatePracticeQuestionTool: AgentTool<
  { topic: string; difficulty?: number },
  GeneratedQuestion
> = {
  name: 'generate_practice_question',
  description:
    'Generate one multiple-choice practice question at a given difficulty (1-5) to probe or reinforce the student\'s understanding.',
  parameters: {
    type: 'object',
    properties: {
      topic: { type: 'string' },
      difficulty: { type: 'integer', minimum: 1, maximum: 5 },
    },
    required: ['topic'],
  },
  async run({ topic, difficulty }, ctx) {
    const target = difficulty ?? 3;
    const result = await chatCompletionStructured<GeneratedQuestion>(
      [
        {
          role: 'system',
          content: `You are a tutor generating a single MCQ. Difficulty 1 = definition recall, 5 = multi-step transfer. Keep it unambiguous.`,
        },
        {
          role: 'user',
          content: `Topic: ${topic}\nTarget difficulty: ${target}/5. Generate one MCQ with 4 plausible options labelled "A) ...", "B) ...", "C) ...", "D) ...". Explain WHY the correct answer is right in 1-2 sentences.`,
        },
      ],
      SCHEMA,
      {
        route: 'agent.generate-practice-question',
        temperature: 0.5,
        logContext: { userId: ctx.userId, parentCallId: ctx.parentCallId, toolName: 'generate_practice_question' },
      }
    );
    return result;
  },
};
