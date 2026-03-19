import { createHash } from "node:crypto";

import type { JsonlQueue, QueueJob } from "../adapters/jsonl-queue.js";
import type { FactoryObjectiveInput, FactoryService } from "../services/factory-service.js";
import { factoryChatCodexArtifactPaths, readTextTail } from "../services/factory-codex-artifacts.js";
import {
  runAgent,
  type AgentFinalizer,
  type AgentRunInput,
  type AgentRunResult,
  type AgentToolExecutor,
} from "./agent.js";

export const CODEX_SUPERVISOR_WORKFLOW_ID = "agent-codex-supervisor-v1";
export const CODEX_SUPERVISOR_WORKFLOW_VERSION = "1.0.0";

const DIRECT_WORKSPACE_TOOLS = new Set(["ls", "read", "replace", "write", "bash", "grep", "agent.delegate"]);

export const CODEX_SUPERVISOR_TOOL_ALLOWLIST = [
  "memory.read",
  "memory.search",
  "memory.summarize",
  "agent.status",
  "agent.inspect",
  "jobs.list",
  "codex.logs",
  "codex.status",
  "codex.run",
  "factory.dispatch",
  "factory.status",
  "factory.output",
  "skill.read",
] as const;

type CodexSupervisorRunInput = AgentRunInput & {
  readonly queue: JsonlQueue;
  readonly supervisorSessionId?: string;
  readonly dataDir?: string;
  readonly factoryService?: FactoryService;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const asStringList = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];

const clip = (value: string, max = 220): string =>
  value.length <= max ? value : `${value.slice(0, max - 3)}...`;

const deriveObjectiveTitle = (prompt: string): string => {
  const compact = prompt.replace(/\s+/g, " ").trim();
  if (!compact) return "Factory objective";
  const sentence = compact.split(/[.!?]/)[0] ?? compact;
  return sentence.slice(0, 96).trim() || "Factory objective";
};

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values.filter((value) => value.trim().length > 0))];

const isActiveJobStatus = (status: string | undefined): boolean =>
  status === "queued" || status === "leased" || status === "running";

const stableCodexSessionKey = (supervisorSessionId: string, prompt: string): string =>
  `codex:${supervisorSessionId}:${createHash("sha1").update(prompt).digest("hex").slice(0, 12)}`;

const readCodexArtifacts = async (dataDir: string, jobId: string): Promise<{
  readonly artifacts: ReturnType<typeof factoryChatCodexArtifactPaths>;
  readonly lastMessage?: string;
  readonly stdoutTail?: string;
  readonly stderrTail?: string;
}> => {
  const artifacts = factoryChatCodexArtifactPaths(dataDir, jobId);
  const [lastMessage, stdoutTail, stderrTail] = await Promise.all([
    readTextTail(artifacts.lastMessagePath, 400),
    readTextTail(artifacts.stdoutPath, 900),
    readTextTail(artifacts.stderrPath, 600),
  ]);
  return {
    artifacts,
    lastMessage,
    stdoutTail,
    stderrTail,
  };
};

const normalizeJobSnapshot = (job: QueueJob): Record<string, unknown> => {
  const result = asRecord(job.result);
  const failure = asRecord(result?.failure);
  const task = asString(job.payload.task)
    ?? asString(job.payload.prompt)
    ?? asString(job.payload.problem)
    ?? asString(job.payload.kind)
    ?? `${job.agentId} job`;
  const terminalSummary = job.status === "failed"
    ? job.lastError ?? asString(failure?.message)
    : job.status === "canceled"
      ? job.canceledReason ?? asString(result?.note)
      : undefined;
  const summary = terminalSummary
    ?? asString(result?.summary)
    ?? asString(result?.finalResponse)
    ?? asString(result?.note)
    ?? asString(result?.message)
    ?? asString(failure?.message)
    ?? job.lastError
    ?? clip(task);
  return {
    jobId: job.id,
    status: job.status,
    worker: asString(result?.worker) ?? job.agentId,
    agentId: job.agentId,
    summary,
    task: clip(task),
    runId: asString(result?.runId) ?? asString(job.payload.runId),
    stream: asString(result?.stream) ?? asString(job.payload.stream),
    parentRunId: asString(job.payload.parentRunId),
    parentStream: asString(job.payload.parentStream),
    supervisorSessionId: asString(job.payload.supervisorSessionId),
    lastMessage: asString(result?.lastMessage),
    stdoutTail: asString(result?.stdoutTail),
    stderrTail: asString(result?.stderrTail),
    changedFiles: asStringList(result?.changedFiles),
    note: asString(result?.note),
  };
};

const codexJobSnapshot = async (job: QueueJob, dataDir?: string): Promise<Record<string, unknown>> => {
  const base = normalizeJobSnapshot(job);
  if (job.agentId !== "codex" || !dataDir) return base;
  const artifactSnapshot = await readCodexArtifacts(dataDir, job.id);
  return {
    ...base,
    artifacts: artifactSnapshot.artifacts,
    lastMessage: artifactSnapshot.lastMessage ?? base.lastMessage,
    stdoutTail: artifactSnapshot.stdoutTail ?? base.stdoutTail,
    stderrTail: artifactSnapshot.stderrTail ?? base.stderrTail,
  };
};

const jobMatchesSupervisor = (
  job: QueueJob,
  input: {
    readonly runId: string;
    readonly stream: string;
    readonly supervisorSessionId: string;
  },
): boolean => {
  const payloadSupervisorSessionId = asString(job.payload.supervisorSessionId);
  const parentRunId = asString(job.payload.parentRunId);
  const parentStream = asString(job.payload.parentStream);
  return payloadSupervisorSessionId === input.supervisorSessionId
    || parentRunId === input.runId
    || parentStream === input.stream;
};

const listSupervisorJobs = async (
  queue: JsonlQueue,
  input: {
    readonly runId: string;
    readonly stream: string;
    readonly supervisorSessionId: string;
  },
): Promise<ReadonlyArray<QueueJob>> => {
  const jobs = await queue.listJobs({ limit: 200 });
  return jobs.filter((job) => jobMatchesSupervisor(job, input));
};

const summarizeObjective = (detail: Awaited<ReturnType<FactoryService["getObjective"]>>) => ({
  objectiveId: detail.objectiveId,
  title: detail.title,
  status: detail.status,
  phase: detail.phase,
  summary: detail.latestSummary ?? detail.nextAction ?? detail.title,
  integrationStatus: detail.integration.status,
  latestCommitHash: detail.latestCommitHash,
  link: `/factory?objective=${encodeURIComponent(detail.objectiveId)}`,
});

const createCodexRunTool = (input: {
  readonly queue: JsonlQueue;
  readonly runId: string;
  readonly stream: string;
  readonly supervisorSessionId: string;
  readonly dataDir?: string;
}): AgentToolExecutor =>
  async (toolInput) => {
    const prompt = asString(toolInput.prompt) ?? asString(toolInput.task);
    if (!prompt) throw new Error("codex.run requires prompt");
    const timeoutMs = typeof toolInput.timeoutMs === "number" && Number.isFinite(toolInput.timeoutMs)
      ? Math.max(30_000, Math.min(Math.floor(toolInput.timeoutMs), 900_000))
      : 180_000;
    const created = await input.queue.enqueue({
      agentId: "codex",
      lane: "collect",
      sessionKey: stableCodexSessionKey(input.supervisorSessionId, prompt),
      singletonMode: "steer",
      maxAttempts: 1,
      payload: {
        kind: "codex.run",
        parentRunId: input.runId,
        parentStream: input.stream,
        supervisorSessionId: input.supervisorSessionId,
        stream: input.stream,
        mode: "read_only_probe",
        readOnly: true,
        task: prompt,
        prompt,
        timeoutMs,
      },
    });
    const result: Record<string, unknown> = {
      ...(await codexJobSnapshot(created, input.dataDir)),
      worker: "codex",
      mode: "read_only_probe",
      readOnly: true,
      summary: `codex read-only probe queued as ${created.id}`,
    };
    return {
      output: JSON.stringify(result, null, 2),
      summary: String(result.summary),
    };
  };

const createCodexStatusTool = (input: {
  readonly queue: JsonlQueue;
  readonly runId: string;
  readonly stream: string;
  readonly supervisorSessionId: string;
  readonly dataDir?: string;
}): AgentToolExecutor =>
  async (toolInput) => {
    const jobId = asString(toolInput.jobId);
    if (jobId) {
      const job = await input.queue.getJob(jobId);
      if (!job) throw new Error(`job ${jobId} not found`);
      if (job.agentId !== "codex") throw new Error(`job ${jobId} is not a codex job`);
      const snapshot = await codexJobSnapshot(job, input.dataDir);
      return {
        output: JSON.stringify({
          worker: "codex",
          activeCount: isActiveJobStatus(job.status) ? 1 : 0,
          latest: snapshot,
          jobs: [snapshot],
        }, null, 2),
        summary: `codex ${jobId}: ${String(snapshot.status)}`,
      };
    }

    const limit = typeof toolInput.limit === "number" && Number.isFinite(toolInput.limit)
      ? Math.max(1, Math.min(Math.floor(toolInput.limit), 10))
      : 5;
    const includeCompleted = toolInput.includeCompleted === true;
    const sessionJobs = (await listSupervisorJobs(input.queue, input))
      .filter((job) => job.agentId === "codex")
      .sort((left, right) =>
        Number(isActiveJobStatus(right.status)) - Number(isActiveJobStatus(left.status))
        || right.updatedAt - left.updatedAt
      );
    const selectedJobs = includeCompleted
      ? sessionJobs
      : (() => {
        const activeJobs = sessionJobs.filter((job) => isActiveJobStatus(job.status));
        return activeJobs.length > 0 ? activeJobs : sessionJobs;
      })();
    const snapshots = await Promise.all(selectedJobs.slice(0, limit).map((job) => codexJobSnapshot(job, input.dataDir)));
    return {
      output: JSON.stringify({
        worker: "codex",
        activeCount: sessionJobs.filter((job) => isActiveJobStatus(job.status)).length,
        latest: snapshots[0],
        jobs: snapshots,
      }, null, 2),
      summary: snapshots[0]
        ? `codex ${String(snapshots[0].jobId)}: ${String(snapshots[0].status)}`
        : "0 codex jobs",
    };
  };

const createCodexLogsTool = (input: {
  readonly queue: JsonlQueue;
  readonly runId: string;
  readonly stream: string;
  readonly supervisorSessionId: string;
  readonly dataDir: string;
}): AgentToolExecutor =>
  async (toolInput) => {
    const requestedJobId = asString(toolInput.jobId);
    let job = requestedJobId ? await input.queue.getJob(requestedJobId) : undefined;
    if (requestedJobId && !job) throw new Error(`job ${requestedJobId} not found`);
    if (!job) {
      job = (await listSupervisorJobs(input.queue, input))
        .filter((candidate) => candidate.agentId === "codex")
        .sort((left, right) => right.updatedAt - left.updatedAt)[0];
    }
    if (!job) throw new Error("no codex child jobs found for this agent session");
    if (job.agentId !== "codex") throw new Error(`job ${job.id} is not a codex job`);
    const snapshot = await codexJobSnapshot(job, input.dataDir);
    return {
      output: JSON.stringify({
        worker: "codex",
        action: "logs",
        ...snapshot,
      }, null, 2),
      summary: `codex logs ${job.id}: ${String(snapshot.status ?? job.status)}`,
    };
  };

const createJobsListTool = (input: {
  readonly queue: JsonlQueue;
  readonly runId: string;
  readonly stream: string;
  readonly supervisorSessionId: string;
}): AgentToolExecutor =>
  async (toolInput) => {
    const limit = typeof toolInput.limit === "number" && Number.isFinite(toolInput.limit)
      ? Math.max(1, Math.min(Math.floor(toolInput.limit), 20))
      : 10;
    const includeCompleted = toolInput.includeCompleted === true;
    const statusFilter = asString(toolInput.status);
    const jobs = (await listSupervisorJobs(input.queue, input))
      .filter((job) => includeCompleted || isActiveJobStatus(job.status))
      .filter((job) => !statusFilter || job.status === statusFilter)
      .slice(0, limit)
      .map((job) => normalizeJobSnapshot(job));
    return {
      output: JSON.stringify(jobs, null, 2),
      summary: `${jobs.length} jobs`,
    };
  };

const createFactoryDispatchTool = (input: {
  readonly factoryService: FactoryService;
}): AgentToolExecutor =>
  async (toolInput) => {
    const objectiveId = asString(toolInput.objectiveId);
    const action = asString(toolInput.action) ?? (objectiveId ? "react" : "create");
    let detail: Awaited<ReturnType<FactoryService["getObjective"]>>;
    if (action === "create") {
      const prompt = asString(toolInput.prompt);
      if (!prompt) throw new Error("factory.dispatch create requires prompt");
      const payload: FactoryObjectiveInput = {
        title: asString(toolInput.title) ?? deriveObjectiveTitle(prompt),
        prompt,
        baseHash: asString(toolInput.baseHash),
        checks: asStringList(toolInput.checks),
        channel: asString(toolInput.channel),
        profileId: asString(toolInput.profileId),
      };
      detail = await input.factoryService.createObjective(payload);
    } else if (action === "react") {
      if (!objectiveId) throw new Error("factory.dispatch react requires objectiveId");
      await input.factoryService.reactObjective(objectiveId);
      detail = await input.factoryService.getObjective(objectiveId);
    } else if (action === "promote") {
      if (!objectiveId) throw new Error("factory.dispatch promote requires objectiveId");
      detail = await input.factoryService.promoteObjective(objectiveId);
    } else if (action === "cancel") {
      if (!objectiveId) throw new Error("factory.dispatch cancel requires objectiveId");
      detail = await input.factoryService.cancelObjective(objectiveId, asString(toolInput.reason));
    } else if (action === "cleanup") {
      if (!objectiveId) throw new Error("factory.dispatch cleanup requires objectiveId");
      detail = await input.factoryService.cleanupObjectiveWorkspaces(objectiveId);
    } else if (action === "archive") {
      if (!objectiveId) throw new Error("factory.dispatch archive requires objectiveId");
      detail = await input.factoryService.archiveObjective(objectiveId);
    } else {
      throw new Error(`unsupported factory.dispatch action '${action}'`);
    }
    const summary = summarizeObjective(detail);
    return {
      output: JSON.stringify({
        worker: "factory",
        action,
        ...summary,
      }, null, 2),
      summary: summary.summary,
    };
  };

const createFactoryStatusTool = (input: {
  readonly factoryService: FactoryService;
}): AgentToolExecutor =>
  async (toolInput) => {
    const objectiveId = asString(toolInput.objectiveId);
    if (!objectiveId) throw new Error("factory.status requires objectiveId");
    const [detail, debug] = await Promise.all([
      input.factoryService.getObjective(objectiveId),
      input.factoryService.getObjectiveDebug(objectiveId),
    ]);
    const summary = summarizeObjective(detail);
    return {
      output: JSON.stringify({
        worker: "factory",
        action: "status",
        ...summary,
        activeJobs: debug.activeJobs,
        taskWorktrees: debug.taskWorktrees,
        integrationWorktree: debug.integrationWorktree,
        recentReceipts: debug.recentReceipts.slice(0, 12),
        latestContextPacks: debug.latestContextPacks,
      }, null, 2),
      summary: summary.summary,
    };
  };

const createFactoryOutputTool = (input: {
  readonly factoryService: FactoryService;
}): AgentToolExecutor =>
  async (toolInput) => {
    const objectiveId = asString(toolInput.objectiveId);
    const focusKind = asString(toolInput.focusKind);
    const focusId = asString(toolInput.focusId);
    if (!objectiveId) throw new Error("factory.output requires objectiveId");
    if (focusKind !== "task" && focusKind !== "job") {
      throw new Error("factory.output requires focusKind of 'task' or 'job'");
    }
    if (!focusId) throw new Error("factory.output requires focusId");
    const liveOutput = await input.factoryService.getObjectiveLiveOutput(objectiveId, focusKind, focusId);
    return {
      output: JSON.stringify({
        worker: "factory",
        action: "output",
        ...liveOutput,
      }, null, 2),
      summary: liveOutput.summary ?? `${focusKind} ${focusId}: ${liveOutput.status}`,
    };
  };

const createActiveCodexChildFinalizer = (input: {
  readonly queue: JsonlQueue;
  readonly runId: string;
  readonly stream: string;
  readonly supervisorSessionId: string;
}): AgentFinalizer =>
  async () => {
    const jobs = await listSupervisorJobs(input.queue, input);
    const activeCodex = jobs
      .filter((job) => job.agentId === "codex" && isActiveJobStatus(job.status))
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const primary = activeCodex[0];
    if (!primary) return { accept: true };
    return {
      accept: false,
      note: `codex child ${primary.id} is still ${primary.status}; continue monitoring with codex.status or agent.status`,
    };
  };

const combineFinalizers = (
  first: AgentFinalizer,
  second?: AgentRunInput["finalizer"],
): AgentFinalizer =>
  async (input) => {
    const firstResult = await first(input);
    if (!firstResult.accept || !second) return firstResult;
    const secondResult = await second(input);
    return {
      accept: secondResult.accept,
      text: secondResult.text ?? firstResult.text,
      note: secondResult.note ?? firstResult.note,
    };
  };

export const runCodexSupervisor = async (input: CodexSupervisorRunInput): Promise<AgentRunResult> => {
  const supervisorSessionId = asString(input.supervisorSessionId) ?? input.runId;
  const dynamicToolAllowlist = CODEX_SUPERVISOR_TOOL_ALLOWLIST.filter((name) =>
    (name !== "codex.logs" || Boolean(input.dataDir))
    && (!name.startsWith("factory.") || Boolean(input.factoryService))
  );
  const toolAllowlist = unique([
    ...dynamicToolAllowlist,
    ...(input.toolAllowlist ?? []),
  ]).filter((name) => !DIRECT_WORKSPACE_TOOLS.has(name));

  return runAgent({
    ...input,
    workflowId: CODEX_SUPERVISOR_WORKFLOW_ID,
    workflowVersion: CODEX_SUPERVISOR_WORKFLOW_VERSION,
    toolAllowlist,
    extraConfig: {
      ...(input.extraConfig ?? {}),
      executionMode: "codex_supervisor",
      codeAccess: "codex_only",
      supervisorSessionId,
    },
    extraToolSpecs: {
      "jobs.list": "{\"limit\"?: number, \"status\"?: string, \"includeCompleted\"?: boolean} — List child jobs launched by this agent session.",
      ...(input.dataDir ? {
        "codex.logs": "{\"jobId\"?: string} — Inspect Codex child logs and artifact paths for this agent session. Without jobId, use the latest Codex child.",
      } : {}),
      "codex.status": "{\"jobId\"?: string, \"limit\"?: number, \"includeCompleted\"?: boolean} — Inspect Codex child jobs for this agent session. With jobId, inspect that specific child.",
      "codex.run": "{\"prompt\": string, \"timeoutMs\"?: number} — Queue a read-only Codex child probe for repo inspection or evidence-gathering. Use factory.dispatch for code changes.",
      ...(input.factoryService ? {
        "factory.dispatch": "{\"action\"?: \"create\"|\"react\"|\"promote\"|\"cancel\"|\"cleanup\"|\"archive\", \"objectiveId\"?: string, \"prompt\"?: string, \"title\"?: string, \"baseHash\"?: string, \"checks\"?: string[], \"channel\"?: string, \"profileId\"?: string, \"reason\"?: string} — Create or operate on a tracked Factory objective. Use this when the work should run in objective-managed worktrees.",
        "factory.status": "{\"objectiveId\": string} — Inspect objective status, active jobs, recent receipts, and task/integration worktrees.",
        "factory.output": "{\"objectiveId\": string, \"focusKind\": \"task\"|\"job\", \"focusId\": string} — Inspect live output and log tails for an objective task or job.",
      } : {}),
      ...(input.extraToolSpecs ?? {}),
    },
    extraTools: {
      ...input.extraTools,
      "jobs.list": createJobsListTool({
        queue: input.queue,
        runId: input.runId,
        stream: input.stream,
        supervisorSessionId,
      }),
      "codex.status": createCodexStatusTool({
        queue: input.queue,
        runId: input.runId,
        stream: input.stream,
        supervisorSessionId,
        dataDir: input.dataDir,
      }),
      "codex.run": createCodexRunTool({
        queue: input.queue,
        runId: input.runId,
        stream: input.stream,
        supervisorSessionId,
        dataDir: input.dataDir,
      }),
      ...(input.dataDir ? {
        "codex.logs": createCodexLogsTool({
          queue: input.queue,
          runId: input.runId,
          stream: input.stream,
          supervisorSessionId,
          dataDir: input.dataDir,
        }),
      } : {}),
      ...(input.factoryService ? {
        "factory.dispatch": createFactoryDispatchTool({
          factoryService: input.factoryService,
        }),
        "factory.status": createFactoryStatusTool({
          factoryService: input.factoryService,
        }),
        "factory.output": createFactoryOutputTool({
          factoryService: input.factoryService,
        }),
      } : {}),
    },
    finalizer: combineFinalizers(
      createActiveCodexChildFinalizer({
        queue: input.queue,
        runId: input.runId,
        stream: input.stream,
        supervisorSessionId,
      }),
      input.finalizer,
    ),
  });
};
