import { chatCompletion, type OllamaMessage } from '../ollama.service.js';
import { retrieveChunks, type RetrievalScope, type RetrievedChunk } from './retriever.service.js';

export interface AnswerCitation {
  index: number;
  materialId: string;
  materialTitle: string;
  page: number | null;
  heading: string | null;
  snippet: string;
}

export interface AnswerResult {
  answer: string;
  citations: AnswerCitation[];
  chunks: RetrievedChunk[];
}

export interface AnswerOptions {
  scope: RetrievalScope;
  userId?: string;
  /** Streaming callback — fired per token for SSE. */
  onToken?: (token: string) => void;
  /** Hard latency cap; defaults to 20s. */
  signal?: AbortSignal;
}

const SYSTEM_PROMPT = `You are a rigorous academic tutor answering a student's question using ONLY the provided course material excerpts.

Rules:
1. Cite every factual claim inline using [n] where n is the 1-indexed excerpt number. Multiple: [1][3].
2. If the excerpts do not contain the answer, say so plainly — do NOT invent facts. Suggest what the student could upload or ask instead.
3. Prefer the student's textbook language over your own paraphrase when terminology matters.
4. Format with markdown: short paragraphs, bullets for enumerations, KaTeX ($...$) for math.
5. End with a one-line "Next step:" suggestion for follow-up study.

Keep the answer concise and well-structured.`;

export async function answerWithCitations(
  question: string,
  options: AnswerOptions
): Promise<AnswerResult> {
  const chunks = await retrieveChunks(question, options.scope);
  const citations = chunks.map((c, i) => toCitation(c, i + 1));
  const contextBlock = formatContext(chunks);

  const messages: OllamaMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Student question: ${question}\n\n--- Course material excerpts ---\n${contextBlock}\n--- End excerpts ---`,
    },
  ];

  const answer = await chatCompletion(messages, {
    route: 'ask-course',
    temperature: 0.2,
    signal: options.signal,
    onChunk: options.onToken,
    logContext: {
      userId: options.userId ?? null,
      metadata: {
        courseId: options.scope.courseId ?? null,
        topicId: options.scope.topicId ?? null,
        retrievedChunks: chunks.length,
      },
    },
  });

  return { answer, citations, chunks };
}

function formatContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return '(no relevant excerpts retrieved — answer accordingly)';
  }
  return chunks
    .map((c, i) => {
      const locator = [
        c.materialTitle,
        c.page ? `p.${c.page}` : null,
        c.heading ? `§ ${c.heading}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      return `[${i + 1}] ${locator}\n${c.content}`;
    })
    .join('\n\n');
}

function toCitation(chunk: RetrievedChunk, index: number): AnswerCitation {
  return {
    index,
    materialId: chunk.materialId,
    materialTitle: chunk.materialTitle,
    page: chunk.page,
    heading: chunk.heading,
    snippet: chunk.content.slice(0, 240).replace(/\s+/g, ' ').trim(),
  };
}
