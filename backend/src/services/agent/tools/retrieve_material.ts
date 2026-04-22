import { retrieveChunks, type RetrievalScope } from '../../rag/retriever.service.js';
import type { AgentTool } from './types.js';

export const retrieveMaterialTool: AgentTool<
  { query: string; topK?: number },
  { chunks: Array<{ index: number; material: string; page: number | null; heading: string | null; content: string }> }
> = {
  name: 'retrieve_material',
  description:
    'Search the student\'s uploaded course materials for passages relevant to a query. Returns citation-ready chunks.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Natural-language search query.' },
      topK: { type: 'number', description: 'Number of chunks to return (default 6).' },
    },
    required: ['query'],
  },
  async run({ query, topK }, ctx) {
    const scope: RetrievalScope = {
      courseId: ctx.courseId,
      topicId: ctx.topicId,
      userId: ctx.userId,
    };
    const chunks = await retrieveChunks(query, scope, topK ?? 6);
    return {
      chunks: chunks.map((c, i) => ({
        index: i + 1,
        material: c.materialTitle,
        page: c.page,
        heading: c.heading,
        content: c.content.slice(0, 1200),
      })),
    };
  },
};
