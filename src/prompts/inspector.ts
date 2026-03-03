// ============================================================================
// Receipt Inspector prompt templates (loaded from JSON files)
// ============================================================================

import fs from "node:fs";
import path from "node:path";

import { hashPrompts } from "./hash.js";

export type InspectorPromptConfig = {
  readonly system: string;
  readonly modes: Record<string, string>;
};

const mergeDeep = (base: Record<string, any>, override: Record<string, any>) => {
  const out: Record<string, any> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof base[k] === "object") {
      out[k] = mergeDeep(base[k], v as Record<string, any>);
    } else {
      out[k] = v;
    }
  }
  return out;
};

const emptyPrompts: InspectorPromptConfig = { system: "", modes: {} };

const readJson = (file: string): InspectorPromptConfig =>
  JSON.parse(fs.readFileSync(file, "utf-8")) as InspectorPromptConfig;

export const loadInspectorPrompts = (): InspectorPromptConfig => {
  const baseFile = path.join(process.cwd(), "prompts", "inspector.prompts.json");
  const overrideFile = process.env.INSPECTOR_PROMPTS_PATH;

  let base: InspectorPromptConfig = emptyPrompts;
  if (fs.existsSync(baseFile)) {
    try {
      base = readJson(baseFile);
    } catch {
      console.warn(`[inspector] Invalid prompt JSON at ${baseFile}`);
    }
  } else if (!overrideFile) {
    console.warn(`[inspector] Missing prompt file ${baseFile}`);
  }

  if (overrideFile) {
    if (fs.existsSync(overrideFile)) {
      try {
        const override = readJson(overrideFile);
        return mergeDeep(base, override) as InspectorPromptConfig;
      } catch {
        console.warn(`[inspector] Invalid prompt JSON at ${overrideFile}`);
      }
    } else {
      console.warn(`[inspector] Override prompt file not found: ${overrideFile}`);
    }
  }

  return base;
};

export const renderPrompt = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? "");

export const hashInspectorPrompts = (prompts: InspectorPromptConfig): string => hashPrompts(prompts);
