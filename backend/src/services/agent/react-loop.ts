import { chatCompletion, type OllamaMessage } from '../ollama.service.js';
import { env } from '../../config/env.js';
import { logger } from '../observability/logger.js';
import { allTools, toolByName, type AgentTool, type AgentToolContext } from './tools/index.js';
import { buildAgentSystemPrompt, type PromptContext } from './prompts.js';
import { selectStrategy, type StrategyInput } from './strategy.js';
import type { TutorStrategy } from '@prisma/client';

export interface ReactTurn {
  kind: 'thought' | 'tool_call' | 'tool_result' | 'answer';
  content: string;
  tool?: string;
  args?: unknown;
  result?: unknown;
  elapsedMs: number;
}

export interface ReactOptions {
  userMessage: string;
  history: OllamaMessage[];
  promptContext: PromptContext;
  strategyInput: Partial<StrategyInput> & Pick<StrategyInput, 'lastUserMessage'>;
  toolContext: AgentToolContext;
  maxIterations?: number;
  wallClockMs?: number;
  enableTools?: boolean;
  /** Streaming callback — one event per ReAct step. */
  onEvent?: (turn: ReactTurn) => void;
  /** Token-level streaming for the final answer. */
  onAnswerToken?: (token: string) => void;
}

export interface ReactResult {
  strategy: TutorStrategy;
  answer: string;
  steps: ReactTurn[];
}

const TOOL_BLOCK = /```tool\s*([\s\S]*?)```/;

/**
 * Minimal ReAct loop driven by the conversation's assistant messages: the model
 * either emits a ```tool``` JSON block (we execute, feed the result back, loop)
 * or a plain-text answer (we stream tokens and stop).
 *
 * Hard-capped by `maxIterations` and `wallClockMs` so a stuck agent never
 * blocks the user. Falls back to the last assistant message on timeout.
 */
export async function runReactLoop(options: ReactOptions): Promise<ReactResult> {
  const {
    userMessage,
    history,
    promptContext,
    strategyInput,
    toolContext,
    onEvent,
    onAnswerToken,
  } = options;

  const maxIter = options.maxIterations ?? env.AGENT_MAX_ITERATIONS;
  const wallClock = options.wallClockMs ?? env.AGENT_WALL_CLOCK_MS;
  const toolsEnabled = options.enableTools ?? env.ENABLE_AGENT_TOOLS;

  const strategy = selectStrategy({
    expertiseLevel: strategyInput.expertiseLevel,
    assistantTurns: strategyInput.assistantTurns ?? 0,
    recentSocraticProbe: strategyInput.recentSocraticProbe ?? false,
    lastUserMessage: strategyInput.lastUserMessage,
  });

  const tools = toolsEnabled ? allTools : [];
  const systemPrompt = buildAgentSystemPrompt(
    strategy,
    promptContext,
    tools.map((t) => t.name)
  );

  const messages: OllamaMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage },
  ];

  const steps: ReactTurn[] = [];
  const startedAt = Date.now();

  for (let iter = 0; iter < maxIter; iter++) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > wallClock) {
      logger.warn({ elapsed, iter }, 'react.timeout');
      break;
    }

    const isFinalIteration = iter === maxIter - 1;

    // Let the last iteration stream tokens to the caller — earlier iterations
    // buffer so we can inspect for tool calls before emitting anything.
    let assistantText = '';
    const onChunk = isFinalIteration && onAnswerToken
      ? (t: string) => {
          assistantText += t;
          onAnswerToken(t);
        }
      : undefined;

    const response = await chatCompletion(messages, {
      route: 'agent.react',
      temperature: 0.3,
      onChunk,
      logContext: {
        userId: toolContext.userId,
        strategy,
        parentCallId: toolContext.parentCallId,
        metadata: { iteration: iter, courseId: toolContext.courseId, topicId: toolContext.topicId },
      },
    });

    if (!onChunk) assistantText = response;

    const toolMatch = TOOL_BLOCK.exec(assistantText);
    if (!toolMatch || isFinalIteration) {
      const answer = assistantText.replace(TOOL_BLOCK, '').trim();
      const step: ReactTurn = { kind: 'answer', content: answer, elapsedMs: Date.now() - startedAt };
      steps.push(step);
      onEvent?.(step);
      return { strategy, answer, steps };
    }

    const thoughtText = assistantText.replace(TOOL_BLOCK, '').trim();
    if (thoughtText) {
      const step: ReactTurn = {
        kind: 'thought',
        content: thoughtText,
        elapsedMs: Date.now() - startedAt,
      };
      steps.push(step);
      onEvent?.(step);
    }

    let parsed: { name: string; arguments?: Record<string, unknown> };
    try {
      parsed = JSON.parse(toolMatch[1].trim());
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'react.tool_parse_failed');
      messages.push({ role: 'assistant', content: assistantText });
      messages.push({
        role: 'user',
        content: 'Your last tool block was not valid JSON. Emit a single ```tool\n{...}\n``` block or answer directly.',
      });
      continue;
    }

    const tool = toolByName(parsed.name);
    if (!tool) {
      messages.push({ role: 'assistant', content: assistantText });
      messages.push({
        role: 'user',
        content: `Tool "${parsed.name}" is not available. Pick one of: ${tools.map((t) => t.name).join(', ')}.`,
      });
      continue;
    }

    const callStep: ReactTurn = {
      kind: 'tool_call',
      tool: tool.name,
      args: parsed.arguments,
      content: '',
      elapsedMs: Date.now() - startedAt,
    };
    steps.push(callStep);
    onEvent?.(callStep);

    let toolResult: unknown;
    try {
      toolResult = await (tool as AgentTool<Record<string, unknown>, unknown>).run(
        parsed.arguments ?? {},
        toolContext
      );
    } catch (err) {
      toolResult = { error: (err as Error).message };
      logger.warn({ err: (err as Error).message, tool: tool.name }, 'react.tool_failed');
    }

    const resultStep: ReactTurn = {
      kind: 'tool_result',
      tool: tool.name,
      result: toolResult,
      content: JSON.stringify(toolResult).slice(0, 2000),
      elapsedMs: Date.now() - startedAt,
    };
    steps.push(resultStep);
    onEvent?.(resultStep);

    messages.push({ role: 'assistant', content: assistantText });
    messages.push({
      role: 'user',
      content: `Tool result for ${tool.name}:\n\`\`\`json\n${JSON.stringify(toolResult).slice(0, 3000)}\n\`\`\`\nContinue reasoning. Emit another tool call OR your final answer.`,
    });
  }

  const lastAnswer = steps.filter((s) => s.kind === 'answer').pop();
  return {
    strategy,
    answer: lastAnswer?.content ?? 'I was unable to complete the reasoning in time. Please try again with a more specific question.',
    steps,
  };
}
