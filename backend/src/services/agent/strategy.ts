import type { TutorStrategy } from '@prisma/client';

export interface StrategyInput {
  /** Most recent user message in the conversation. */
  lastUserMessage: string;
  /** Posterior mean of the student's Beta distribution on this topic [0, 1]. */
  expertiseLevel?: number;
  /** Count of prior assistant turns in this conversation. */
  assistantTurns?: number;
  /** Whether the current conversation has already used a Socratic probe recently. */
  recentSocraticProbe?: boolean;
}

const UNDERSTANDING_PATTERNS = [
  /\bi\s*don'?t\s+understand\b/i,
  /\bconfus/i,
  /\bstuck\b/i,
  /\bcan\s+you\s+explain\b/i,
  /\bwhy\b/i,
];

const TEST_ME_PATTERNS = [/\btest\s+me\b/i, /\bquiz\s+me\b/i, /\bpractice\b/i];

const MISCONCEPTION_SIGNALS = [
  /\bi\s+thought\b/i,
  /\bisn'?t\s+it\s+(just|simply|always)\b/i,
  /\balways\b.*\b(works|wrong)\b/i,
];

const WORKED_EXAMPLE_TRIGGERS = [
  /\bshow\s+me\s+an?\s+example\b/i,
  /\bhow\s+do\s+(i|you|we)\b/i,
  /\bwalk\s+me\s+through\b/i,
];

/**
 * Deterministic strategy selector. The rules favour Socratic for early turns on
 * under-mastered topics, Misconception for classic "I thought..." phrasings,
 * Worked example for "how do I..." requests, Hint ladder when the student is
 * stuck mid-problem, and Explain as a neutral default.
 *
 * This mirrors the "cognitive tutor" family in Koedinger et al. — keep the
 * rule surface small and testable; reach for the LLM only at the margins.
 */
export function selectStrategy(input: StrategyInput): TutorStrategy {
  const msg = input.lastUserMessage ?? '';
  const mastery = input.expertiseLevel ?? 0.5;
  const turns = input.assistantTurns ?? 0;

  if (MISCONCEPTION_SIGNALS.some((r) => r.test(msg))) return 'MISCONCEPTION_PROBE';
  if (TEST_ME_PATTERNS.some((r) => r.test(msg))) return 'HINT_LADDER';
  if (WORKED_EXAMPLE_TRIGGERS.some((r) => r.test(msg))) return 'WORKED_EXAMPLE';

  if (UNDERSTANDING_PATTERNS.some((r) => r.test(msg))) {
    // If mastery is low AND we haven't probed yet, start Socratic to surface
    // the misconception before dumping an explanation.
    if (mastery < 0.4 && !input.recentSocraticProbe && turns < 4) return 'SOCRATIC';
    return 'EXPLAIN';
  }

  // Mid-mastery student asking an open question → Socratic probe calibrates faster.
  if (mastery >= 0.3 && mastery <= 0.7 && turns === 0 && !input.recentSocraticProbe) {
    return 'SOCRATIC';
  }

  return 'EXPLAIN';
}
