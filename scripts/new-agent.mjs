#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const id = process.argv[2]?.trim();

if (!id) {
  console.error("Usage: npm run new:agent -- <agent-id>");
  process.exit(1);
}
if (!/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error(`Invalid agent id "${id}". Use kebab-case (letters, digits, hyphen).`);
  process.exit(1);
}

const pascal = id
  .split("-")
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
  .join("");

const files = {
  module: path.join(ROOT, "src/modules", `${id}.ts`),
  agent: path.join(ROOT, "src/agents", `${id}.ts`),
  prompt: path.join(ROOT, "prompts", `${id}.prompts.json`),
  test: path.join(ROOT, "tests/smoke", `${id}.smoke.test.ts`),
};

for (const [kind, file] of Object.entries(files)) {
  if (fs.existsSync(file)) {
    console.error(`${kind} already exists: ${file}`);
    process.exit(1);
  }
}

const writeFile = (file, body) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf-8");
};

writeFile(files.module, `// ============================================================================
// ${pascal} module
// ============================================================================

import type { Decide, Reducer } from "../core/types.js";

export type ${pascal}Event =
  | { readonly type: "problem.set"; readonly runId: string; readonly problem: string }
  | { readonly type: "run.configured"; readonly runId: string; readonly workflow: { readonly id: string; readonly version: string }; readonly model: string }
  | { readonly type: "run.status"; readonly runId: string; readonly status: "running" | "failed" | "completed"; readonly note?: string }
  | { readonly type: "solution.finalized"; readonly runId: string; readonly content: string; readonly confidence: number };

export type ${pascal}Cmd = {
  readonly type: "emit";
  readonly event: ${pascal}Event;
  readonly eventId: string;
  readonly expectedPrev?: string;
};

export type ${pascal}State = {
  readonly runId?: string;
  readonly problem: string;
  readonly status: "idle" | "running" | "failed" | "completed";
  readonly statusNote?: string;
  readonly solution?: { readonly content: string; readonly confidence: number; readonly updatedAt: number };
};

export const initial: ${pascal}State = {
  problem: "",
  status: "idle",
};

export const decide: Decide<${pascal}Cmd, ${pascal}Event> = (cmd) => [cmd.event];

export const reduce: Reducer<${pascal}State, ${pascal}Event> = (state, event, ts) => {
  switch (event.type) {
    case "problem.set":
      return { ...initial, runId: event.runId, problem: event.problem, status: "running" };
    case "run.configured":
      return state;
    case "run.status":
      return { ...state, status: event.status === "running" ? "running" : event.status, statusNote: event.note ?? state.statusNote };
    case "solution.finalized":
      return {
        ...state,
        status: "completed",
        solution: { content: event.content, confidence: event.confidence, updatedAt: ts },
      };
    default:
      return state;
  }
};
`);

writeFile(files.agent, `// ============================================================================
// ${pascal} agent
// ============================================================================

import type { Runtime } from "../core/runtime.js";
import { createQueuedEmitter } from "../engine/runtime/workflow.js";
import { defineReceiptAgent, runReceiptAgent } from "../engine/runtime/receipt-runtime.js";
import type { ${pascal}Cmd, ${pascal}Event, ${pascal}State } from "../modules/${id}.js";
import { reduce, initial } from "../modules/${id}.js";

const WORKFLOW_ID = "${id}";
const WORKFLOW_VERSION = "0.1.0";

type ${pascal}Deps = {
  readonly runtime: Runtime<${pascal}Cmd, ${pascal}Event, ${pascal}State>;
  readonly llmText: (opts: { readonly system?: string; readonly user: string }) => Promise<string>;
  readonly model: string;
};

type ${pascal}Config = {
  readonly problem: string;
};

const SPEC = defineReceiptAgent<${pascal}Cmd, ${pascal}Deps, ${pascal}Event, ${pascal}State, ${pascal}Config>({
  id: WORKFLOW_ID,
  version: WORKFLOW_VERSION,
  reducer: reduce,
  initial,
  lifecycle: {
    init: (ctx, runId, config) => [
      { type: "problem.set", runId, problem: config.problem },
      { type: "run.configured", runId, workflow: { id: WORKFLOW_ID, version: WORKFLOW_VERSION }, model: ctx.model },
      { type: "run.status", runId, status: "running" },
    ],
  },
  plan: {
    id: WORKFLOW_ID,
    version: WORKFLOW_VERSION,
    capabilities: [],
    goals: [],
  },
  run: async (ctx, config) => {
    const final = await ctx.llmText({ user: config.problem });
    await ctx.emit({ type: "solution.finalized", runId: ctx.runId, content: final.trim() || "No output.", confidence: 0.6 });
    await ctx.emit({ type: "run.status", runId: ctx.runId, status: "completed" });
  },
  command: {
    wrap: (event, meta) => ({ type: "emit", event, eventId: meta.eventId }),
  },
});

export const run${pascal} = async (input: {
  readonly stream: string;
  readonly runId: string;
  readonly runtime: Runtime<${pascal}Cmd, ${pascal}Event, ${pascal}State>;
  readonly problem: string;
  readonly model: string;
  readonly llmText: (opts: { readonly system?: string; readonly user: string }) => Promise<string>;
}): Promise<void> => {
  const emit = createQueuedEmitter({
    runtime: input.runtime,
    stream: input.stream,
    wrap: (event, meta) => ({ type: "emit", event, eventId: meta.eventId }),
  });

  await runReceiptAgent({
    spec: SPEC,
    ctx: {
      stream: input.stream,
      runId: input.runId,
      emit,
      now: Date.now,
      runtime: input.runtime,
      model: input.model,
      llmText: input.llmText,
    },
    config: { problem: input.problem },
  });
};
`);

writeFile(files.prompt, `{
  "system": "You are a focused specialist agent.",
  "user": {
    "task": "Solve the problem clearly and concisely.\\n\\nProblem:\\n{{problem}}"
  }
}
`);

writeFile(files.test, `import assert from "node:assert/strict";
import test from "node:test";

test("${id}: scaffold placeholder", () => {
  assert.equal(typeof "${id}", "string");
});
`);

console.log(`Created agent scaffold:
- ${path.relative(ROOT, files.module)}
- ${path.relative(ROOT, files.agent)}
- ${path.relative(ROOT, files.prompt)}
- ${path.relative(ROOT, files.test)}
`);
