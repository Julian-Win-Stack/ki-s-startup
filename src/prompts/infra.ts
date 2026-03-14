import { hashPrompts } from "./hash.js";
import { loadPromptConfig, renderPrompt as renderPromptTemplate } from "./common.js";

export type InfraPromptConfig = {
  readonly system: string;
  readonly user: {
    readonly loop: string;
  };
};

export const loadInfraPrompts = (): InfraPromptConfig =>
  loadPromptConfig<InfraPromptConfig>({
    name: "infra",
    tag: "infra",
  });

export const renderPrompt = (template: string, vars: Record<string, string>): string =>
  renderPromptTemplate(template, vars);

export const hashInfraPrompts = (prompts: InfraPromptConfig): string => hashPrompts(prompts);
