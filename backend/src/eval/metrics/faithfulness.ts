import { chatCompletionStructured } from '../../services/ollama.service.js';

const SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number', minimum: 0, maximum: 1 },
    reasoning: { type: 'string' },
  },
  required: ['score', 'reasoning'],
};

interface JudgeVerdict {
  score: number;
  reasoning: string;
}

/**
 * LLM-as-judge faithfulness: how well does the answer stay grounded in the
 * retrieved context? 1 = every claim in the answer is supported; 0 = the
 * answer mostly hallucinates. Runs 3× and majority-averages to dampen noise
 * from the 7B judge.
 */
export async function faithfulness(
  question: string,
  answer: string,
  contexts: string[]
): Promise<{ score: number; votes: number[]; reasonings: string[] }> {
  const votes: number[] = [];
  const reasonings: string[] = [];
  for (let i = 0; i < 3; i++) {
    const verdict = await chatCompletionStructured<JudgeVerdict>(
      [
        {
          role: 'system',
          content:
            'You are a strict evaluator. Score 0-1 how well the ANSWER\'s factual claims are supported by the CONTEXT. Score 1 only if every claim is directly entailed. Hallucinated or unsupported claims lower the score.',
        },
        {
          role: 'user',
          content: `QUESTION: ${question}\n\nCONTEXT:\n${contexts.join('\n---\n')}\n\nANSWER:\n${answer}`,
        },
      ],
      SCHEMA,
      { route: 'eval.faithfulness', temperature: 0 }
    );
    votes.push(verdict.score);
    reasonings.push(verdict.reasoning);
  }
  const score = votes.reduce((a, b) => a + b, 0) / votes.length;
  return { score, votes, reasonings };
}
