export interface AgentToolContext {
  userId?: string;
  courseId?: string;
  topicId?: string;
  /** Parent LlmCall id — used so tool-triggered sub-calls are linked in observability. */
  parentCallId?: string;
}

export interface AgentTool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run(args: TArgs, ctx: AgentToolContext): Promise<TResult>;
}
