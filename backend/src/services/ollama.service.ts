import { env } from '../config/env.js';
import {
  approxTokens,
  withLogging,
  type LlmLogContext,
} from './observability/llm-logger.js';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

interface OllamaStreamChunk {
  model: string;
  message?: { role: string; content: string };
  response?: string;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaChatResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export interface ChatOptions {
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
  temperature?: number;
  topP?: number;
  numCtx?: number;
  /** Ollama's `format` — either the literal string "json" or a JSON schema object. */
  format?: 'json' | Record<string, unknown>;
  /** Route label for observability; defaults to 'chat'. */
  route?: string;
  logContext?: LlmLogContext;
}

/**
 * Primary chat entry point. Streams when `onChunk` is set, otherwise returns the
 * full completion in one shot. Always goes through the LLM logger so every call
 * lands in LlmCall + Prometheus.
 */
export async function chatCompletion(
  messages: OllamaMessage[],
  onChunkOrOptions?: ((text: string) => void) | ChatOptions,
  legacyOptions?: ChatOptions
): Promise<string> {
  const options: ChatOptions =
    typeof onChunkOrOptions === 'function'
      ? { onChunk: onChunkOrOptions, ...(legacyOptions ?? {}) }
      : (onChunkOrOptions ?? {});

  const route = options.route ?? 'chat';

  return withLogging<string>(
    route,
    async () => {
      const body: Record<string, unknown> = {
        model: env.OLLAMA_MODEL,
        messages,
        stream: !!options.onChunk,
      };
      const ollamaOptions: Record<string, unknown> = {};
      if (options.temperature !== undefined) ollamaOptions.temperature = options.temperature;
      if (options.topP !== undefined) ollamaOptions.top_p = options.topP;
      if (options.numCtx !== undefined) ollamaOptions.num_ctx = options.numCtx;
      if (Object.keys(ollamaOptions).length) body.options = ollamaOptions;
      if (options.format) body.format = options.format;

      const response = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      let full = '';
      let promptTokens: number | undefined;
      let completionTokens: number | undefined;

      if (options.onChunk && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const chunk: OllamaStreamChunk = JSON.parse(line);
              if (chunk.message?.content) {
                full += chunk.message.content;
                options.onChunk(chunk.message.content);
              }
              if (chunk.done) {
                promptTokens = chunk.prompt_eval_count;
                completionTokens = chunk.eval_count;
              }
            } catch {
              // Ollama occasionally splits JSON across chunks — skip garbage.
            }
          }
        }
      } else {
        const data = (await response.json()) as OllamaChatResponse;
        full = data.message?.content ?? '';
        promptTokens = data.prompt_eval_count;
        completionTokens = data.eval_count;
      }

      return {
        value: full,
        completion: full,
        prompt: { model: env.OLLAMA_MODEL, messages, options: ollamaOptions, format: options.format ?? null },
        promptTokens: promptTokens ?? approxTokens(messages.map((m) => m.content).join('\n')),
        completionTokens: completionTokens ?? approxTokens(full),
      };
    },
    { ...(options.logContext ?? {}), model: env.OLLAMA_MODEL }
  );
}

/**
 * Structured chat completion: forces Ollama to emit JSON matching `schema`.
 * Throws if the response cannot be JSON-parsed — callers should surround in
 * their own retry/fallback. qwen2.5:7b-instruct complies well with this.
 */
export async function chatCompletionStructured<T = unknown>(
  messages: OllamaMessage[],
  schema: Record<string, unknown>,
  options: Omit<ChatOptions, 'format' | 'onChunk'> = {}
): Promise<T> {
  const raw = await chatCompletion(messages, {
    ...options,
    format: schema,
    route: options.route ?? 'chat.structured',
  });
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error(`Structured output is not valid JSON: ${trimmed.slice(0, 200)}`);
  }
}

/**
 * Embed one or more texts via Ollama's /api/embed endpoint.
 * nomic-embed-text returns 768-dim vectors. Returns a flat array of vectors
 * aligned with input order.
 */
export async function embed(
  input: string | string[],
  options: { signal?: AbortSignal; logContext?: LlmLogContext } = {}
): Promise<number[][]> {
  const texts = Array.isArray(input) ? input : [input];
  if (texts.length === 0) return [];

  return withLogging<number[][]>(
    'embed',
    async () => {
      const response = await fetch(`${env.OLLAMA_BASE_URL}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: env.OLLAMA_EMBEDDING_MODEL,
          input: texts,
        }),
        signal: options.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama embed error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        embeddings: number[][];
        prompt_eval_count?: number;
      };

      if (!Array.isArray(data.embeddings) || data.embeddings.length !== texts.length) {
        throw new Error(`Ollama embed returned ${data.embeddings?.length ?? 0} vectors for ${texts.length} inputs`);
      }

      return {
        value: data.embeddings,
        completion: '',
        prompt: { model: env.OLLAMA_EMBEDDING_MODEL, inputCount: texts.length },
        promptTokens: data.prompt_eval_count ?? approxTokens(texts.join('\n')),
        completionTokens: 0,
      };
    },
    { ...(options.logContext ?? {}), model: env.OLLAMA_EMBEDDING_MODEL }
  );
}

export function buildSystemPrompt(courseName?: string, topicTitle?: string): string {
  let context = '';
  if (courseName) context += `Course: "${courseName}". `;
  if (topicTitle) context += `Topic: "${topicTitle}". `;

  return `You are an intelligent academic tutor for university students on the Cognitive Copilot platform.
${context ? `Context: ${context}` : ''}
You help students understand topics deeply, generate quizzes, explain concepts clearly,
suggest study materials, and adapt to the student's level.
Be concise, structured, and pedagogically sound.
When generating quizzes, output strict JSON: { "questions": [{"id": "q1", "question": "...", "options": ["A","B","C","D"], "correct": "A"}] }
When not generating quizzes, use markdown formatting for clarity.`;
}
