import { retrieveMaterialTool } from './retrieve_material.js';
import { searchWebTool } from './search_web.js';
import { generatePracticeQuestionTool } from './generate_practice_question.js';
import { renderDiagramTool } from './render_diagram.js';
import { runCodeTool } from './run_code.js';
import type { AgentTool } from './types.js';

export const allTools: AgentTool[] = [
  retrieveMaterialTool as AgentTool,
  searchWebTool as AgentTool,
  generatePracticeQuestionTool as AgentTool,
  renderDiagramTool as AgentTool,
  runCodeTool as AgentTool,
];

export function toolByName(name: string): AgentTool | undefined {
  return allTools.find((t) => t.name === name);
}

export { type AgentTool, type AgentToolContext } from './types.js';
