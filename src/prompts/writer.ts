// ============================================================================
// Writer Guild prompt templates (loaded from JSON files)
// ============================================================================

import fs from "node:fs";
import path from "node:path";

import { hashPrompts } from "./hash.js";

export type WriterPromptConfig = {
  readonly system: Record<string, string>;
  readonly user: Record<string, string>;
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

const emptyPrompts: WriterPromptConfig = { system: {}, user: {} };

const readJson = (file: string): WriterPromptConfig =>
  JSON.parse(fs.readFileSync(file, "utf-8")) as WriterPromptConfig;

export const loadWriterPrompts = (): WriterPromptConfig => {
  const baseFile = path.join(process.cwd(), "prompts", "writer.prompts.json");
  const overrideFile = process.env.WRITER_PROMPTS_PATH;

  let base: WriterPromptConfig = emptyPrompts;
  if (fs.existsSync(baseFile)) {
    try {
      base = readJson(baseFile);
    } catch {
      console.warn(`[writer] Invalid prompt JSON at ${baseFile}`);
    }
  } else if (!overrideFile) {
    console.warn(`[writer] Missing prompt file ${baseFile}`);
  }

  if (overrideFile) {
    if (fs.existsSync(overrideFile)) {
      try {
        const override = readJson(overrideFile);
        return mergeDeep(base, override) as WriterPromptConfig;
      } catch {
        console.warn(`[writer] Invalid prompt JSON at ${overrideFile}`);
      }
    } else {
      console.warn(`[writer] Override prompt file not found: ${overrideFile}`);
    }
  }

  return base;
};

export const renderPrompt = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? "");

export const hashWriterPrompts = (prompts: WriterPromptConfig): string => hashPrompts(prompts);
