import fs from "node:fs";
import path from "node:path";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeDeep = <T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>
): T => {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const baseValue = out[key];
    if (isPlainObject(value) && isPlainObject(baseValue)) {
      out[key] = mergeDeep(baseValue, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
};

const readJson = <T>(file: string): T =>
  JSON.parse(fs.readFileSync(file, "utf-8")) as T;

export const loadPromptConfig = <T extends Record<string, unknown>>(opts: {
  readonly name: string;
  readonly overridePath?: string;
  readonly empty: T;
  readonly tag: string;
}): T => {
  const baseFile = path.join(process.cwd(), "prompts", `${opts.name}.prompts.json`);
  const overrideFile = opts.overridePath;

  let base: T = opts.empty;
  if (fs.existsSync(baseFile)) {
    try {
      base = readJson<T>(baseFile);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`[${opts.tag}] Invalid prompt JSON at ${baseFile}: ${message}`);
    }
  } else if (!overrideFile) {
    throw new Error(`[${opts.tag}] Missing prompt file ${baseFile}`);
  } else {
    console.warn(`[${opts.tag}] Missing base prompt file ${baseFile}; using override only`);
  }

  if (overrideFile) {
    if (fs.existsSync(overrideFile)) {
      try {
        const override = readJson<Record<string, unknown>>(overrideFile);
        return mergeDeep(base, override);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`[${opts.tag}] Invalid prompt JSON at ${overrideFile}: ${message}`);
      }
    } else {
      throw new Error(`[${opts.tag}] Override prompt file not found: ${overrideFile}`);
    }
  }

  return base;
};

export const renderPrompt = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`Missing template variable: {{${key}}}`);
    return value;
  });
