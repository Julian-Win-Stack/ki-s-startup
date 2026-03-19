import { test, expect } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { jsonBranchStore, jsonlStore } from "../../src/adapters/jsonl.ts";
import { jsonlQueue } from "../../src/adapters/jsonl-queue.ts";
import type { DelegationTools } from "../../src/adapters/delegation.ts";
import type { MemoryTools } from "../../src/adapters/memory-tools.ts";
import { runCodexSupervisor } from "../../src/agents/codex-supervisor.ts";
import { createRuntime } from "../../src/core/runtime.ts";
import type { AgentCmd, AgentEvent, AgentState } from "../../src/modules/agent.ts";
import { decide as decideAgent, reduce as reduceAgent, initial as initialAgent } from "../../src/modules/agent.ts";
import type { JobCmd, JobEvent, JobState } from "../../src/modules/job.ts";
import { decide as decideJob, reduce as reduceJob, initial as initialJob } from "../../src/modules/job.ts";
import type { FactoryService } from "../../src/services/factory-service.ts";

const mkTmp = async (label: string): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));

const mkAgentRuntime = (dir: string) => createRuntime<AgentCmd, AgentEvent, AgentState>(
  jsonlStore<AgentEvent>(dir),
  jsonBranchStore(dir),
  decideAgent,
  reduceAgent,
  initialAgent,
);

const mkJobRuntime = (dir: string) => createRuntime<JobCmd, JobEvent, JobState>(
  jsonlStore<JobEvent>(dir),
  jsonBranchStore(dir),
  decideJob,
  reduceJob,
  initialJob,
);

const mkMemoryTools = (): MemoryTools => ({
  read: async () => [],
  search: async () => [],
  summarize: async () => ({ summary: "", entries: [] }),
  commit: async (input) => ({
    id: `mem_${Date.now().toString(36)}`,
    scope: input.scope,
    text: input.text,
    tags: input.tags,
    meta: input.meta,
    ts: Date.now(),
  }),
  diff: async () => [],
  reindex: async () => 0,
});

const mkDelegationTools = (): DelegationTools => ({
  "agent.delegate": async () => ({ output: "", summary: "" }),
  "agent.status": async () => ({ output: "", summary: "" }),
  "agent.inspect": async () => ({ output: "", summary: "" }),
});

const promptTemplate = {
  system: "",
  user: {
    loop: "{{problem}}\\n{{transcript}}\\n{{memory}}\\n{{workspace}}\\n{{available_tools}}\\n{{tool_help}}",
  },
};

test("codex supervisor blocks direct workspace tools and keeps the agent as a thin orchestrator", async () => {
  const dir = await mkTmp("receipt-codex-supervisor-blocks-direct-tools");
  const dataDir = path.join(dir, "data");
  const workspaceRoot = path.join(dir, "workspace");

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, "note.txt"), "hello", "utf-8");

  const runtime = mkAgentRuntime(dataDir);
  const jobRuntime = mkJobRuntime(dataDir);
  const queue = jsonlQueue({ runtime: jobRuntime, stream: "jobs" });
  const memoryTools = mkMemoryTools();
  const delegationTools = mkDelegationTools();

  let structuredCalls = 0;
  const result = await runCodexSupervisor({
    stream: "agents/agent",
    runId: "direct_tools_blocked",
    problem: "Do not read files directly from this agent.",
    config: {
      maxIterations: 2,
      maxToolOutputChars: 2000,
      memoryScope: "agent",
      workspace: ".",
    },
    runtime,
    prompts: promptTemplate,
    llmText: async () => "unused",
    llmStructured: async () => {
      structuredCalls += 1;
      if (structuredCalls === 1) {
        return {
          parsed: {
            thought: "try to read a file directly",
            action: {
              type: "tool",
              name: "read",
              input: "{\"path\":\"note.txt\"}",
              text: null,
            },
          },
          raw: "",
        };
      }
      return {
        parsed: {
          thought: "done",
          action: {
            type: "final",
            name: null,
            input: "{}",
            text: "complete",
          },
        },
        raw: "",
      };
    },
    model: "test-model",
    apiReady: true,
    memoryTools,
    delegationTools,
    workspaceRoot,
    queue,
    dataDir,
  });

  try {
    const chain = await runtime.chain("agents/agent/runs/direct_tools_blocked");
    const readCall = chain.find((receipt): receipt is typeof receipt & { body: Extract<AgentEvent, { type: "tool.called" }> } =>
      receipt.body.type === "tool.called" && receipt.body.tool === "read"
    );

    expect(result.status).toBe("completed");
    expect(readCall?.body.error ?? "").toMatch(/unknown tool 'read'/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("codex supervisor queues a codex child and rejects premature finalization while the child is active", async () => {
  const dir = await mkTmp("receipt-codex-supervisor-active-child");
  const dataDir = path.join(dir, "data");
  const workspaceRoot = path.join(dir, "workspace");

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });

  const runtime = mkAgentRuntime(dataDir);
  const jobRuntime = mkJobRuntime(dataDir);
  const queue = jsonlQueue({ runtime: jobRuntime, stream: "jobs" });
  const memoryTools = mkMemoryTools();
  const delegationTools = mkDelegationTools();

  let structuredCalls = 0;
  const result = await runCodexSupervisor({
    stream: "agents/agent",
    runId: "active_child_guard",
    problem: "Ship the profile rename via Codex.",
    config: {
      maxIterations: 2,
      maxToolOutputChars: 4000,
      memoryScope: "agent",
      workspace: ".",
    },
    runtime,
    prompts: promptTemplate,
    llmText: async () => "unused",
    llmStructured: async () => {
      structuredCalls += 1;
      if (structuredCalls === 1) {
        return {
          parsed: {
            thought: "launch codex to make the code change",
            action: {
              type: "tool",
              name: "codex.run",
              input: JSON.stringify({ prompt: "Rename sidebar Skill labels to Profile and make the profile copy slightly more verbose." }),
              text: null,
            },
          },
          raw: "",
        };
      }
      return {
        parsed: {
          thought: "claim success too early",
          action: {
            type: "final",
            name: null,
            input: "{}",
            text: "The change is complete.",
          },
        },
        raw: "",
      };
    },
    model: "test-model",
    apiReady: true,
    memoryTools,
    delegationTools,
    workspaceRoot,
    queue,
    dataDir,
  });

  try {
    const jobs = await queue.listJobs({ limit: 10 });
    const chain = await runtime.chain("agents/agent/runs/active_child_guard");
    const finalizerFailure = chain.find((receipt): receipt is typeof receipt & { body: Extract<AgentEvent, { type: "validation.report" }> } =>
      receipt.body.type === "validation.report"
      && receipt.body.gate === "finalizer"
      && receipt.body.ok === false
    );

    expect(result.status).toBe("failed");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.agentId).toBe("codex");
    expect(jobs[0]?.payload.kind).toBe("codex.run");
    expect(finalizerFailure?.body.summary ?? "").toMatch(/codex child .* is still .*continue monitoring/i);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("codex supervisor can poll a completed codex child and then finalize", async () => {
  const dir = await mkTmp("receipt-codex-supervisor-poll-complete");
  const dataDir = path.join(dir, "data");
  const workspaceRoot = path.join(dir, "workspace");

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });

  const runtime = mkAgentRuntime(dataDir);
  const jobRuntime = mkJobRuntime(dataDir);
  const queue = jsonlQueue({ runtime: jobRuntime, stream: "jobs" });
  const memoryTools = mkMemoryTools();
  const delegationTools = mkDelegationTools();

  let structuredCalls = 0;
  let codexJobId = "";
  const result = await runCodexSupervisor({
    stream: "agents/agent",
    runId: "completed_child_poll",
    problem: "Launch Codex, wait for it to finish, then summarize the result.",
    config: {
      maxIterations: 3,
      maxToolOutputChars: 4000,
      memoryScope: "agent",
      workspace: ".",
    },
    runtime,
    prompts: promptTemplate,
    llmText: async () => "unused",
    llmStructured: async () => {
      structuredCalls += 1;
      if (structuredCalls === 1) {
        return {
          parsed: {
            thought: "launch codex first",
            action: {
              type: "tool",
              name: "codex.run",
              input: JSON.stringify({ prompt: "Apply the sidebar rename and report changed files." }),
              text: null,
            },
          },
          raw: "",
        };
      }
      if (structuredCalls === 2) {
        const leased = await queue.leaseNext({ workerId: "tester", leaseMs: 30_000, agentId: "codex" });
        expect(leased?.agentId).toBe("codex");
        if (leased) {
          await queue.complete(leased.id, "tester", {
            status: "completed",
            summary: "Codex updated the sidebar labels.",
            lastMessage: "Profile copy updated.",
            changedFiles: ["src/views/factory-chat.ts"],
          });
        }
        return {
          parsed: {
            thought: "poll the codex child",
            action: {
              type: "tool",
              name: "codex.status",
              input: "{}",
              text: null,
            },
          },
          raw: "",
        };
      }
      return {
        parsed: {
          thought: "finalize after the child is done",
          action: {
            type: "final",
            name: null,
            input: "{}",
            text: "Codex completed and reported the changed files.",
          },
        },
        raw: "",
      };
    },
    model: "test-model",
    apiReady: true,
    memoryTools,
    delegationTools,
    workspaceRoot,
    queue,
    dataDir,
  });

  try {
    const chain = await runtime.chain("agents/agent/runs/completed_child_poll");
    const statusObservation = chain.find((receipt): receipt is typeof receipt & { body: Extract<AgentEvent, { type: "tool.observed" }> } =>
      receipt.body.type === "tool.observed" && receipt.body.tool === "codex.status"
    );

    expect(result.status).toBe("completed");
    expect(result.finalResponse).toContain("Codex completed");
    expect(statusObservation?.body.output ?? "").toContain('"status": "completed"');
    expect(statusObservation?.body.output ?? "").toContain('"changedFiles": [');
    expect(statusObservation?.body.output ?? "").toContain("src/views/factory-chat.ts");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("codex supervisor can inspect direct codex child logs and artifact paths", async () => {
  const dir = await mkTmp("receipt-codex-supervisor-logs");
  const dataDir = path.join(dir, "data");
  const workspaceRoot = path.join(dir, "workspace");

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });

  const runtime = mkAgentRuntime(dataDir);
  const jobRuntime = mkJobRuntime(dataDir);
  const queue = jsonlQueue({ runtime: jobRuntime, stream: "jobs" });
  const memoryTools = mkMemoryTools();
  const delegationTools = mkDelegationTools();

  let structuredCalls = 0;
  let codexJobId = "";
  const result = await runCodexSupervisor({
    stream: "agents/agent",
    runId: "inspect_codex_logs",
    problem: "Launch Codex and inspect its logs.",
    config: {
      maxIterations: 3,
      maxToolOutputChars: 4000,
      memoryScope: "agent",
      workspace: ".",
    },
    runtime,
    prompts: promptTemplate,
    llmText: async () => "unused",
    llmStructured: async () => {
      structuredCalls += 1;
      if (structuredCalls === 1) {
        return {
          parsed: {
            thought: "launch codex first",
            action: {
              type: "tool",
              name: "codex.run",
              input: JSON.stringify({ prompt: "Inspect the repository and keep logs updated." }),
              text: null,
            },
          },
          raw: "",
        };
      }
      if (structuredCalls === 2) {
        const leased = await queue.leaseNext({ workerId: "tester", leaseMs: 30_000, agentId: "codex" });
        expect(leased?.agentId).toBe("codex");
        if (leased) {
          codexJobId = leased.id;
          const root = path.join(dataDir, "factory-chat", "codex", leased.id);
          await fs.mkdir(root, { recursive: true });
          await fs.writeFile(path.join(root, "prompt.md"), "Inspect the repository and keep logs updated.\n", "utf-8");
          await fs.writeFile(path.join(root, "last-message.txt"), "Prepared a log-aware summary.\n", "utf-8");
          await fs.writeFile(path.join(root, "stdout.log"), "Booting Codex\nCollected files\n", "utf-8");
          await fs.writeFile(path.join(root, "stderr.log"), "warning: none\n", "utf-8");
          await queue.progress(leased.id, "tester", {
            worker: "codex",
            status: "running",
            summary: "Codex is still inspecting the repo.",
          });
        }
        return {
          parsed: {
            thought: "inspect the direct codex logs",
            action: {
              type: "tool",
              name: "codex.logs",
              input: "{}",
              text: null,
            },
          },
          raw: "",
        };
      }
      if (codexJobId) {
        await queue.complete(codexJobId, "tester", {
          worker: "codex",
          status: "completed",
          summary: "Codex completed after logs were inspected.",
          lastMessage: "Prepared a log-aware summary.",
        });
      }
      return {
        parsed: {
          thought: "done",
          action: {
            type: "final",
            name: null,
            input: "{}",
            text: "The direct Codex child logs are visible.",
          },
        },
        raw: "",
      };
    },
    model: "test-model",
    apiReady: true,
    memoryTools,
    delegationTools,
    workspaceRoot,
    queue,
    dataDir,
  });

  try {
    const chain = await runtime.chain("agents/agent/runs/inspect_codex_logs");
    const logsObservation = chain.find((receipt): receipt is typeof receipt & { body: Extract<AgentEvent, { type: "tool.observed" }> } =>
      receipt.body.type === "tool.observed" && receipt.body.tool === "codex.logs"
    );

    expect(result.status).toBe("completed");
    expect(logsObservation?.body.output ?? "").toContain("\"lastMessage\": \"Prepared a log-aware summary.\"");
    expect(logsObservation?.body.output ?? "").toContain("\"stdoutTail\": \"Booting Codex\\nCollected files\"");
    expect(logsObservation?.body.output ?? "").toContain("\"stderrTail\": \"warning: none\"");
    expect(logsObservation?.body.output ?? "").toContain("\"artifacts\": {");
    expect(logsObservation?.body.output ?? "").toContain("last-message.txt");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("codex supervisor can inspect factory objectives, worktrees, and live output", async () => {
  const dir = await mkTmp("receipt-codex-supervisor-factory");
  const dataDir = path.join(dir, "data");
  const workspaceRoot = path.join(dir, "workspace");

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(workspaceRoot, { recursive: true });

  const runtime = mkAgentRuntime(dataDir);
  const jobRuntime = mkJobRuntime(dataDir);
  const queue = jsonlQueue({ runtime: jobRuntime, stream: "jobs" });
  const memoryTools = mkMemoryTools();
  const delegationTools = mkDelegationTools();

  const factoryService = {
    createObjective: async (input: Record<string, unknown>) => ({
      objectiveId: "objective_demo",
      title: String(input.title ?? "Objective demo"),
      status: "active",
      phase: "delivery",
      latestSummary: "Objective created and preparing worktrees.",
      nextAction: "Queue the first task run.",
      integration: { status: "pending" },
      latestCommitHash: "abc1234",
    }),
    getObjective: async () => ({
      objectiveId: "objective_demo",
      title: "Objective demo",
      status: "active",
      phase: "delivery",
      latestSummary: "Task work is running in the objective worktree.",
      nextAction: "Wait for task output.",
      integration: { status: "pending" },
      latestCommitHash: "abc1234",
    }),
    getObjectiveDebug: async () => ({
      activeJobs: [{
        id: "job_task_01",
        agentId: "codex",
        status: "running",
        updatedAt: Date.now(),
      }],
      taskWorktrees: [{
        taskId: "task_01",
        workspacePath: "/tmp/objective-demo-task-01",
        exists: true,
        dirty: true,
        head: "abc1234",
        branch: "hub/codex/objective_demo_task_01",
      }],
      integrationWorktree: {
        workspacePath: "/tmp/objective-demo-integration",
        exists: true,
        dirty: false,
        head: "abc1234",
        branch: "hub/integration/objective_demo",
      },
      recentReceipts: [{
        type: "task.started",
        hash: "hash_1",
        ts: Date.now(),
        summary: "task_01 started in its worktree",
      }],
      latestContextPacks: [{
        taskId: "task_01",
        candidateId: "candidate_01",
        contextPackPath: "/tmp/objective-demo-task-01/.receipt/factory/task_01.context-pack.json",
        memoryScriptPath: "/tmp/objective-demo-task-01/.receipt/factory/task_01.memory.cjs",
      }],
    }),
    getObjectiveLiveOutput: async () => ({
      objectiveId: "objective_demo",
      focusKind: "task",
      focusId: "task_01",
      title: "Implement profile rename",
      status: "running",
      active: true,
      summary: "Applying the profile rename in the objective worktree.",
      taskId: "task_01",
      candidateId: "candidate_01",
      jobId: "job_task_01",
      lastMessage: "Prepared the sidebar patch in the worktree.",
      stdoutTail: "changed src/views/factory-chat.ts",
      stderrTail: "",
    }),
  } as unknown as FactoryService;

  let structuredCalls = 0;
  const result = await runCodexSupervisor({
    stream: "agents/agent",
    runId: "inspect_factory_objective",
    problem: "Use Factory for tracked worktree-backed execution.",
    config: {
      maxIterations: 4,
      maxToolOutputChars: 5000,
      memoryScope: "agent",
      workspace: ".",
    },
    runtime,
    prompts: promptTemplate,
    llmText: async () => "unused",
    llmStructured: async () => {
      structuredCalls += 1;
      if (structuredCalls === 1) {
        return {
          parsed: {
            thought: "create a tracked objective",
            action: {
              type: "tool",
              name: "factory.dispatch",
              input: JSON.stringify({ action: "create", prompt: "Rename Skill to Profile using an objective worktree." }),
              text: null,
            },
          },
          raw: "",
        };
      }
      if (structuredCalls === 2) {
        return {
          parsed: {
            thought: "inspect objective state and worktrees",
            action: {
              type: "tool",
              name: "factory.status",
              input: JSON.stringify({ objectiveId: "objective_demo" }),
              text: null,
            },
          },
          raw: "",
        };
      }
      if (structuredCalls === 3) {
        return {
          parsed: {
            thought: "inspect live task output",
            action: {
              type: "tool",
              name: "factory.output",
              input: JSON.stringify({ objectiveId: "objective_demo", focusKind: "task", focusId: "task_01" }),
              text: null,
            },
          },
          raw: "",
        };
      }
      return {
        parsed: {
          thought: "done",
          action: {
            type: "final",
            name: null,
            input: "{}",
            text: "The Factory objective and worktree logs are visible.",
          },
        },
        raw: "",
      };
    },
    model: "test-model",
    apiReady: true,
    memoryTools,
    delegationTools,
    workspaceRoot,
    queue,
    dataDir,
    factoryService,
  });

  try {
    const chain = await runtime.chain("agents/agent/runs/inspect_factory_objective");
    const statusObservation = chain.find((receipt): receipt is typeof receipt & { body: Extract<AgentEvent, { type: "tool.observed" }> } =>
      receipt.body.type === "tool.observed" && receipt.body.tool === "factory.status"
    );
    const outputObservation = chain.find((receipt): receipt is typeof receipt & { body: Extract<AgentEvent, { type: "tool.observed" }> } =>
      receipt.body.type === "tool.observed" && receipt.body.tool === "factory.output"
    );

    expect(result.status).toBe("completed");
    expect(statusObservation?.body.output ?? "").toContain("\"objectiveId\": \"objective_demo\"");
    expect(statusObservation?.body.output ?? "").toContain("\"taskWorktrees\": [");
    expect(statusObservation?.body.output ?? "").toContain("/tmp/objective-demo-task-01");
    expect(statusObservation?.body.output ?? "").toContain("\"integrationWorktree\": {");
    expect(outputObservation?.body.output ?? "").toContain("\"focusKind\": \"task\"");
    expect(outputObservation?.body.output ?? "").toContain("\"lastMessage\": \"Prepared the sidebar patch in the worktree.\"");
    expect(outputObservation?.body.output ?? "").toContain("\"stdoutTail\": \"changed src/views/factory-chat.ts\"");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
