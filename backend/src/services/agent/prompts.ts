import type { TutorStrategy } from '@prisma/client';

export interface PromptContext {
  courseName?: string;
  topicTitle?: string;
  expertiseLevel?: number;
  studentName?: string;
}

/**
 * Role prompt — who the tutor is, shared across all strategies. Kept short so
 * it competes less with the strategy-specific instructions below.
 */
export function rolePrompt(ctx: PromptContext): string {
  const course = ctx.courseName ? `Course: ${ctx.courseName}.` : '';
  const topic = ctx.topicTitle ? `Topic: ${ctx.topicTitle}.` : '';
  const mastery =
    ctx.expertiseLevel !== undefined
      ? `Student current mastery (posterior mean): ${(ctx.expertiseLevel * 100).toFixed(0)}%.`
      : '';
  return `You are a rigorous, patient academic tutor on the Cognitive Copilot platform. ${course} ${topic} ${mastery}
Your goal is durable understanding, not quick answers. Be concise, structured, and pedagogically sound. Use markdown; use KaTeX ($...$) for math.`;
}

/**
 * Strategy prompt — HOW the tutor speaks this turn. Swapping this string is the
 * single point of control for pedagogy behaviour; nothing else in the stack
 * needs to know which strategy was picked.
 */
export function strategyPrompt(strategy: TutorStrategy): string {
  switch (strategy) {
    case 'SOCRATIC':
      return `Respond with ONE focused diagnostic question that would reveal the student's current mental model of the concept. Do NOT explain the concept yet. Keep the question ≤ 2 sentences. If the student has already answered a diagnostic question in the conversation, build on their answer with the next most informative probe.`;
    case 'HINT_LADDER':
      return `Respond with a graded hint — the minimum nudge needed to unstick the student. Start with a conceptual pointer (not the procedure). Only reveal more if the student explicitly asks. Never give the full solution in the first hint.`;
    case 'WORKED_EXAMPLE':
      return `Walk through ONE concrete worked example end-to-end, labelling each step with WHY (the principle being applied), not just WHAT. Finish by inviting the student to try a close analogue themselves.`;
    case 'MISCONCEPTION_PROBE':
      return `The student's last message suggests a common misconception. Name the misconception plainly, explain why it feels right but is wrong, then walk the student through the correct mental model using a contrasting example.`;
    case 'EXPLAIN':
    default:
      return `Give a clear, well-structured explanation at a level calibrated to the student's current mastery. Use analogies for new concepts, equations where they clarify, and a short summary at the end.`;
  }
}

/**
 * Tool usage prompt — appended when the ReAct loop is enabled so the model
 * knows which tools it can call and under what syntax.
 */
export function toolsPrompt(toolNames: string[]): string {
  if (toolNames.length === 0) return '';
  return `
You have access to tools. To call a tool, emit a JSON code block:
\`\`\`tool
{ "name": "<tool_name>", "arguments": { ... } }
\`\`\`
Exactly one tool call per turn. After a tool result is returned, continue reasoning; emit a final answer without a tool block when you are ready.

Available tools: ${toolNames.join(', ')}.

Prefer \`retrieve_material\` before answering any content question. Prefer \`search_web\` only when course materials don't cover the topic. Use \`generate_practice_question\` when the student says "test me" or their last answer reveals a gap. Use \`render_diagram\` when a visual would help.`;
}

export function buildAgentSystemPrompt(
  strategy: TutorStrategy,
  ctx: PromptContext,
  toolNames: string[] = []
): string {
  return [rolePrompt(ctx), strategyPrompt(strategy), toolsPrompt(toolNames)]
    .filter(Boolean)
    .join('\n\n');
}
