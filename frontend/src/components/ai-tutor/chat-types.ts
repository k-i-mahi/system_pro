import type { TutorStrategy } from './StrategyBadge';
import type { TutorTurn } from './TutorTrace';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  strategy?: TutorStrategy;
  trace?: TutorTurn[];
}
