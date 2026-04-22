import { searchWeb } from '../../search.service.js';
import type { AgentTool } from './types.js';

export const searchWebTool: AgentTool<
  { query: string; type?: string; limit?: number },
  { results: Array<{ title: string; url?: string; snippet?: string; source?: string }> }
> = {
  name: 'search_web',
  description:
    'Search the public web for supplementary references (YouTube, MIT OCW, arXiv, blog explanations). Use ONLY when course materials are insufficient.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string' },
      type: { type: 'string', enum: ['video', 'article', 'all'] },
      limit: { type: 'number', description: 'Max results (default 5).' },
    },
    required: ['query'],
  },
  async run({ query, type, limit }) {
    const results = await searchWeb(query, type, limit ?? 5);
    return { results: results.slice(0, limit ?? 5) };
  },
};
