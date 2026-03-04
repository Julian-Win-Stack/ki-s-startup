// ============================================================================
// Agent prompt templates (loaded from JSON files)
// ============================================================================

import { hashPrompts } from "./hash.js";
import { loadPromptConfig, renderPrompt as renderPromptTemplate } from "./common.js";

export type AgentPromptConfig = {
  readonly system: string;
  readonly user: {
    readonly loop: string;
  };
};

const emptyPrompts: AgentPromptConfig = {
  system: "",
  user: {
    loop: "",
  },
};

export const loadAgentPrompts = (): AgentPromptConfig =>
  loadPromptConfig<AgentPromptConfig>({
    name: "agent",
    overridePath: process.env.AGENT_PROMPTS_PATH,
    empty: emptyPrompts,
    tag: "agent",
  });

export const renderPrompt = (template: string, vars: Record<string, string>): string =>
  renderPromptTemplate(template, vars);

export const hashAgentPrompts = (prompts: AgentPromptConfig): string => hashPrompts(prompts);
