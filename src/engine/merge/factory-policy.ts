import {
  buildFactoryProjection,
  factoryReadyTasks,
  type FactoryCandidateRecord,
  type FactoryState,
  type FactoryTaskRecord,
  type FactoryWorkerType,
} from "../../modules/factory";

export type FactoryActionType =
  | "dispatch_child"
  | "split_task"
  | "reassign_task"
  | "update_dependencies"
  | "unblock_task"
  | "supersede_task"
  | "queue_integration"
  | "promote_integration"
  | "block_objective";

export type FactoryActionTaskDraft = {
  readonly title: string;
  readonly prompt: string;
  readonly workerType: FactoryWorkerType;
};

export type FactoryAction = {
  readonly actionId: string;
  readonly type: FactoryActionType;
  readonly label: string;
  readonly taskId?: string;
  readonly candidateId?: string;
  readonly workerType?: FactoryWorkerType;
  readonly dependsOn?: ReadonlyArray<string>;
  readonly tasks?: ReadonlyArray<FactoryActionTaskDraft>;
  readonly summary?: string;
};

export type FactoryDecisionSet = {
  readonly frontierTaskIds: ReadonlyArray<string>;
  readonly actions: ReadonlyArray<FactoryAction>;
  readonly summary: string;
};


const DISCOVERY_ONLY_RE = /\b(search|locate|identify|inspect|find|trace|look\s+for|determine|record)\b/i;
const DIFF_PRODUCING_RE = /\b(edit|change|update|remove|add|implement|write|modify|refactor|fix|test|verify|run|create)\b/i;
const NEEDS_SPLIT_RE = /\b(split|smaller|unblock task|before implementation can continue|missing dependency|missing detail|missing details)\b/i;
const NEEDS_REASSIGN_RE = /\b(worker|specialist|codex|ownership)\b/i;

export const MAX_CONSECUTIVE_TASK_FAILURES = 5;
const TASK_RETRY_BASE_MS = 30_000;
const TASK_RETRY_MAX_MS = 600_000;

const taskRetryBackoffMs = (failures: number): number =>
  Math.min(TASK_RETRY_BASE_MS * Math.pow(2, Math.max(0, failures - 1)), TASK_RETRY_MAX_MS);

export const isTaskCircuitBroken = (state: FactoryState, taskId: string): boolean =>
  (state.consecutiveFailuresByTask[taskId] ?? 0) >= MAX_CONSECUTIVE_TASK_FAILURES;

const isTaskInBackoff = (state: FactoryState, task: FactoryTaskRecord, now: number): boolean => {
  const failures = state.consecutiveFailuresByTask[task.taskId] ?? 0;
  if (failures === 0) return false;
  const blockedAt = task.completedAt ?? 0;
  return now - blockedAt < taskRetryBackoffMs(failures);
};

const directDependents = (
  state: FactoryState,
  taskId: string,
): ReadonlyArray<FactoryTaskRecord> => state.taskOrder
  .map((id) => state.graph.nodes[id])
  .filter((task): task is FactoryTaskRecord => Boolean(task))
  .filter((task) => task.dependsOn.includes(taskId));

const dependsTransitivelyOn = (
  state: FactoryState,
  taskId: string,
  targetTaskId: string,
  seen = new Set<string>(),
): boolean => {
  if (seen.has(taskId)) return false;
  seen.add(taskId);
  const task = state.graph.nodes[taskId];
  if (!task) return false;
  if (task.dependsOn.includes(targetTaskId)) return true;
  return task.dependsOn.some((depId) => dependsTransitivelyOn(state, depId, targetTaskId, seen));
};

const normalizeDependencies = (
  state: FactoryState,
  taskId: string,
  requested: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const taskIndex = state.taskOrder.indexOf(taskId);
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const depId of requested) {
    const trimmed = depId.trim();
    if (!trimmed || trimmed === taskId || seen.has(trimmed)) continue;
    const dep = state.graph.nodes[trimmed];
    if (!dep || dep.status === "superseded") continue;
    const depIndex = state.taskOrder.indexOf(trimmed);
    if (taskIndex >= 0 && depIndex >= taskIndex) continue;
    if (dependsTransitivelyOn(state, trimmed, taskId)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
};

const isDiscoveryOnlyTask = (task: Pick<FactoryTaskRecord, "title" | "prompt">): boolean => {
  const text = `${task.title}\n${task.prompt}`;
  return DISCOVERY_ONLY_RE.test(text) && !DIFF_PRODUCING_RE.test(text);
};

const blockReason = (task: FactoryTaskRecord): string =>
  task.blockedReason ?? task.latestSummary ?? `Task ${task.taskId} is blocked.`;

const buildMutationActions = (
  state: FactoryState,
  now: number,
): ReadonlyArray<FactoryAction> => {
  if (state.policy.mutation.aggressiveness === "off") return [];
  if (
    state.lastMutationAt
    && now - state.lastMutationAt < state.policy.throttles.mutationCooldownMs
  ) {
    return [];
  }

  const allTasks = state.taskOrder
    .map((taskId) => state.graph.nodes[taskId])
    .filter((task): task is FactoryTaskRecord => Boolean(task));
  const blockedTasks = allTasks.filter((task) => task.status === "blocked");
  const pendingTasks = allTasks.filter((task) => task.status === "pending");
  const readyTasks = allTasks.filter((task) => task.status === "ready");
  const mutableTasks = (() => {
    switch (state.policy.mutation.aggressiveness) {
      case "conservative":
        return blockedTasks;
      case "aggressive":
        return [...blockedTasks, ...readyTasks.slice(0, 2), ...pendingTasks.slice(0, 2)];
      case "balanced":
      default:
        return blockedTasks.length > 0 ? [...blockedTasks, ...pendingTasks.slice(0, 2)] : [];
    }
  })();

  const actions: FactoryAction[] = [];
  for (const task of mutableTasks) {
    if (task.status === "blocked") {
      const reason = blockReason(task);
      if (
        task.blockedReason?.startsWith("factory task produced no tracked diff")
        && isDiscoveryOnlyTask(task)
        && directDependents(state, task.taskId).some((dependent) => ["pending", "ready", "blocked"].includes(dependent.status))
      ) {
        actions.push({
          actionId: `action_supersede_${task.taskId}_no_diff`,
          type: "supersede_task",
          label: `Bypass ${task.taskId}`,
          taskId: task.taskId,
          summary: `${task.taskId} only produced analysis with no tracked diff. Supersede it and let downstream implementation continue.`,
        });
        continue;
      }
      if (NEEDS_SPLIT_RE.test(reason)) {
        actions.push({
          actionId: `action_split_${task.taskId}`,
          type: "split_task",
          label: `Split ${task.taskId}`,
          taskId: task.taskId,
          summary: reason,
          tasks: [
            {
              title: `Unblock ${task.title}`,
              prompt: `Investigate the blocker for "${task.title}" and capture the missing details needed before implementation can continue.\n\nBlocker: ${reason}`,
              workerType: "codex",
            },
            {
              title: `Finish ${task.title}`,
              prompt: `Resume "${task.title}" using the unblock task output.\n\nOriginal task: ${task.prompt}`,
              workerType: task.workerType,
            },
          ],
        });
        continue;
      }
      if (NEEDS_REASSIGN_RE.test(reason) && task.workerType !== "codex") {
        actions.push({
          actionId: `action_reassign_${task.taskId}_codex`,
          type: "reassign_task",
          label: `Reassign ${task.taskId} to codex`,
          taskId: task.taskId,
          workerType: "codex",
          summary: reason,
        });
        continue;
      }
      if (task.blockedReason?.startsWith("Policy blocked:")) continue;
      if (isTaskCircuitBroken(state, task.taskId)) continue;
      if (isTaskInBackoff(state, task, now)) continue;
      actions.push({
        actionId: `action_unblock_${task.taskId}`,
        type: "unblock_task",
        label: `Unblock ${task.taskId}`,
        taskId: task.taskId,
        summary: reason,
      });
      continue;
    }

    if (state.policy.mutation.aggressiveness === "aggressive" && task.status === "ready" && task.dependsOn.length > 0) {
      const satisfiedDependencies = task.dependsOn
        .map((depId) => state.graph.nodes[depId])
        .filter((dep): dep is FactoryTaskRecord => Boolean(dep))
        .every((dep) => dep.status === "integrated" || dep.status === "superseded");
      if (satisfiedDependencies) {
        const dependsOn = normalizeDependencies(state, task.taskId, []);
        actions.push({
          actionId: `action_deps_${task.taskId}`,
          type: "update_dependencies",
          label: `Flatten ${task.taskId} dependencies`,
          taskId: task.taskId,
          dependsOn,
          summary: `${task.taskId} can proceed without waiting on already-settled dependencies.`,
        });
      }
    }
  }

  return actions;
};

export const buildFactoryDecisionSet = (
  state: FactoryState,
  opts: {
    readonly now?: number;
    readonly dispatchLimit?: number;
    readonly policyBlockedReason?: string;
  } = {},
): FactoryDecisionSet => {
  const now = opts.now ?? Date.now();
  const actions: FactoryAction[] = [];
  const projection = buildFactoryProjection(state);
  const approvedCandidates = state.candidateOrder
    .map((candidateId) => state.candidates[candidateId])
    .filter((candidate): candidate is FactoryCandidateRecord => Boolean(candidate))
    .filter((candidate) => candidate.status === "approved");

  if ((state.integration.status === "idle" || state.integration.status === "conflicted" || state.integration.status === "validated") && approvedCandidates.length > 0) {
    for (const candidate of approvedCandidates) {
      if (state.integration.queuedCandidateIds.includes(candidate.candidateId) || state.integration.activeCandidateId === candidate.candidateId) continue;
      actions.push({
        actionId: `action_queue_${candidate.candidateId}`,
        type: "queue_integration",
        label: `Queue ${candidate.candidateId} for integration`,
        candidateId: candidate.candidateId,
        taskId: candidate.taskId,
        summary: candidate.summary,
      });
    }
  }

  //   // console.log(`[DEBUG buildFactoryDecisionSet] objective: ${state.objectiveId}, integrationStatus: ${state.integration.status}, approvedCandidates: ${approvedCandidates.map(c => c.candidateId).join(",")}, actions:`, actions.map(a => a.type));

  if (state.integration.status === "validated" && state.integration.activeCandidateId && state.policy.promotion.autoPromote) {
    const allDone = state.taskOrder.every((taskId) => {
      const task = state.graph.nodes[taskId];
      return task?.status === "integrated" || task?.status === "superseded" || task?.status === "blocked";
    });
    const someIntegrated = state.taskOrder.some((taskId) => state.graph.nodes[taskId]?.status === "integrated");
    if (allDone && someIntegrated) {
      actions.push({
        actionId: `action_promote_${state.integration.activeCandidateId}`,
        type: "promote_integration",
        label: `Promote integrated candidate ${state.integration.activeCandidateId}`,
        candidateId: state.integration.activeCandidateId,
      });
    }
  }

  const dispatchLimit = Math.max(0, opts.dispatchLimit ?? 0);
  if (dispatchLimit > 0 && state.taskRunsUsed < state.policy.budgets.maxTaskRuns) {
    for (const task of factoryReadyTasks(state).slice(0, dispatchLimit)) {
      actions.push({
        actionId: `action_dispatch_${task.taskId}`,
        type: "dispatch_child",
        label: `Dispatch ${task.taskId}`,
        taskId: task.taskId,
        workerType: task.workerType,
        summary: task.latestSummary ?? task.prompt,
      });
    }
  }

  actions.push(...buildMutationActions(state, now));

  if (
    opts.policyBlockedReason
    && projection.readyTasks.length > 0
    && projection.activeTasks.length === 0
    && state.integration.status === "idle"
  ) {
    actions.push({
      actionId: "action_block_policy",
      type: "block_objective",
      label: "Block objective on policy budget",
      summary: opts.policyBlockedReason,
    });
  } else if (
    projection.tasks.length > 0
    && projection.readyTasks.length === 0
    && projection.activeTasks.length === 0
    && state.integration.status === "idle"
    && projection.tasks.every((task) => ["blocked", "superseded"].includes(task.status))
  ) {
    const blocked = state.taskOrder
      .map((taskId) => state.graph.nodes[taskId])
      .find((task) => task?.status === "blocked");
    actions.push({
      actionId: `action_block_${blocked?.taskId ?? "objective"}`,
      type: "block_objective",
      label: blocked ? `Block objective on ${blocked.taskId}` : "Block objective",
      taskId: blocked?.taskId,
      summary: blocked?.blockedReason ?? "No runnable tasks remained.",
    });
  }

  const frontierTaskIds = [...new Set(actions
    .flatMap((action) => action.taskId ? [action.taskId] : action.candidateId ? [state.candidates[action.candidateId]?.taskId].filter((value): value is string => Boolean(value)) : []))];
  return {
    frontierTaskIds,
    actions,
    summary: actions.length === 0
      ? "No frontier actions available."
      : actions.map((action) => `${action.type}:${action.taskId ?? action.candidateId ?? action.actionId}`).join(", "),
  };
};

export const summarizeFactoryAction = (action: FactoryAction): string =>
  action.summary?.trim()
  || action.label
  || `${action.type}:${action.taskId ?? action.candidateId ?? action.actionId}`;
