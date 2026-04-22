import type { AgentTool } from './types.js';

/**
 * Produces a Mermaid diagram source string. The frontend renders it client-side,
 * so this tool's "run" is a pass-through validator — we check structural sanity
 * (the first line must start with a known Mermaid diagram keyword).
 */
const MERMAID_KEYWORDS = [
  'flowchart',
  'graph',
  'sequenceDiagram',
  'classDiagram',
  'stateDiagram',
  'stateDiagram-v2',
  'erDiagram',
  'gantt',
  'mindmap',
];

export const renderDiagramTool: AgentTool<
  { mermaid: string; caption?: string },
  { mermaid: string; caption: string | null; kind: string }
> = {
  name: 'render_diagram',
  description:
    'Return a Mermaid diagram for the frontend to render. Use when a flow, state machine, or relationship would clarify more than prose.',
  parameters: {
    type: 'object',
    properties: {
      mermaid: { type: 'string', description: 'Valid Mermaid source code.' },
      caption: { type: 'string' },
    },
    required: ['mermaid'],
  },
  async run({ mermaid, caption }) {
    const first = mermaid.trim().split(/\s+/, 1)[0] ?? '';
    const kind = MERMAID_KEYWORDS.find((k) => first.startsWith(k.split('-')[0]));
    if (!kind) {
      throw new Error(
        `render_diagram: first token "${first}" is not a Mermaid diagram keyword`
      );
    }
    return { mermaid: mermaid.trim(), caption: caption ?? null, kind };
  },
};
