// ============================================================================
// Receipt Runtime Planner - typed needs/provides scheduler
// ============================================================================

import type { PlanStep, PlannerEvent, PlannerState } from "../../modules/planner.js";
import { reducePlanner } from "../../modules/planner.js";
import { validatePlan } from "./plan-validate.js";

export type CapabilitySpec<Ctx> = {
  readonly id: string;
  readonly agentId: string;
  readonly needs: ReadonlyArray<string>;
  readonly provides: ReadonlyArray<string>;
  readonly isolation?: "branch" | "main";
  readonly timeoutMs?: number;
  readonly retries?: number;
  readonly run: (ctx: Ctx, inputs: Readonly<Record<string, unknown>>) => Promise<Record<string, unknown>>;
};

export type GoalResult = {
  readonly done: boolean;
  readonly blocked?: string;
};

export type GoalPredicate = (
  outputs: Readonly<Record<string, string>>
) => GoalResult;

export type PlanSpec<Ctx> = {
  readonly id: string;
  readonly version: string;
  readonly capabilities: ReadonlyArray<CapabilitySpec<Ctx>>;
  readonly goal: GoalPredicate;
};

export type ReceiptPlannerRunOptions<Ctx, Event extends PlannerEvent> = {
  readonly runId: string;
  readonly ctx: Ctx;
  readonly emit: (event: Event) => Promise<void>;
  readonly plan: PlanSpec<Ctx>;
  readonly initial: PlannerState;
  readonly maxParallel?: number;
  readonly defaultTimeoutMs?: number;
  readonly defaultRetries?: number;
  readonly retryFailed?: boolean;
};

const toPlanSteps = <Ctx>(plan: PlanSpec<Ctx>): PlanStep[] =>
  plan.capabilities.map((cap) => ({
    id: cap.id,
    capId: cap.id,
    agentId: cap.agentId,
    inputs: cap.needs,
    outputs: cap.provides,
  }));

const stepSucceeded = (state: PlannerState, step: PlanStep): boolean => {
  const status = state.steps[step.id]?.status;
  if (status === "completed") return true;
  return step.outputs.every((key) => state.outputs[key] !== undefined);
};

const stepSettled = (state: PlannerState, step: PlanStep, retryFailed: boolean): boolean => {
  const status = state.steps[step.id]?.status;
  if (status === "failed") return !retryFailed;
  return stepSucceeded(state, step);
};

const stepReady = (state: PlannerState, step: PlanStep): boolean =>
  step.inputs.every((key) => state.outputs[key] !== undefined);

const pickParallel = (steps: PlanStep[], maxParallel: number): PlanStep[] => {
  const selected: PlanStep[] = [];
  const occupied = new Set<string>();
  for (const step of steps) {
    if (selected.length >= maxParallel) break;
    const overlaps = step.outputs.some((out) => occupied.has(out));
    if (overlaps) continue;
    step.outputs.forEach((out) => occupied.add(out));
    selected.push(step);
  }
  return selected;
};

const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  if (ms <= 0) return promise;
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const normalizePatch = (patch: Record<string, unknown>): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string") {
      out[key] = value;
      continue;
    }
    out[key] = JSON.stringify(value);
  }
  return out;
};

export const runReceiptPlanner = async <Ctx, Event extends PlannerEvent>(
  opts: ReceiptPlannerRunOptions<Ctx, Event>
): Promise<PlannerState> => {
  const maxParallel = Math.max(1, opts.maxParallel ?? 4);
  const defaultTimeoutMs = Math.max(0, opts.defaultTimeoutMs ?? 90_000);
  const defaultRetries = Math.max(0, opts.defaultRetries ?? 0);
  const retryFailed = Boolean(opts.retryFailed);
  const steps = toPlanSteps(opts.plan);
  const capabilities = Object.fromEntries(opts.plan.capabilities.map((cap) => [cap.id, cap])) as Record<string, CapabilitySpec<Ctx>>;
  const validate = validatePlan(opts.plan, {
    initialKeys: Object.keys(opts.initial.outputs),
  });

  let state = opts.initial;
  const emit = async (event: PlannerEvent) => {
    state = reducePlanner(state, event, Date.now());
    await opts.emit(event as Event);
  };

  if (!validate.ok) {
    await emit({
      type: "plan.failed",
      runId: opts.runId,
      note: validate.errors.join("; "),
    });
    return state;
  }

  if (!state.plan || state.plan.length === 0) {
    await emit({ type: "plan.configured", runId: opts.runId, steps });
  }
  if (retryFailed && state.status === "failed") {
    await emit({ type: "plan.configured", runId: opts.runId, steps, note: "resumed" });
  }

  let progress = true;
  while (progress) {
    progress = false;
    const ready = steps.filter((step) => stepReady(state, step) && !stepSettled(state, step, retryFailed));
    for (const step of ready) {
      if (state.steps[step.id]?.status !== "ready") {
        await emit({ type: "step.ready", runId: opts.runId, stepId: step.id });
      }
    }

    const runnable = ready.filter((step) => state.steps[step.id]?.status !== "running");
    const batch = pickParallel(runnable, maxParallel);
    if (batch.length === 0) break;
    progress = true;

    const results = await Promise.all(batch.map(async (step) => {
      const cap = capabilities[step.capId];
      if (!cap) {
        const error = `Missing capability ${step.capId}`;
        await emit({
          type: "step.failed",
          runId: opts.runId,
          stepId: step.id,
          error,
        });
        return { ok: false as const, error };
      }

      await emit({
        type: "step.started",
        runId: opts.runId,
        stepId: step.id,
        agentId: cap.agentId,
      });

      const timeoutMs = Math.max(0, cap.timeoutMs ?? defaultTimeoutMs);
      const retries = Math.max(0, cap.retries ?? defaultRetries);
      let failure = "unknown error";
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const patchRaw = await withTimeout(
            cap.run(opts.ctx, state.outputs),
            timeoutMs,
            `${step.id}[attempt=${attempt + 1}]`
          );
          if (!patchRaw || typeof patchRaw !== "object") {
            throw new Error("Capability returned no outputs");
          }
          const patch = normalizePatch(patchRaw);
          const missing = step.outputs.filter((key) => patch[key] === undefined);
          if (missing.length > 0) {
            throw new Error(`Missing outputs: ${missing.join(", ")}`);
          }
          await emit({
            type: "state.patch",
            runId: opts.runId,
            stepId: step.id,
            patch,
          });
          await emit({
            type: "step.completed",
            runId: opts.runId,
            stepId: step.id,
            agentId: cap.agentId,
            outputs: step.outputs,
          });
          return { ok: true as const };
        } catch (err) {
          failure = err instanceof Error ? err.message : String(err);
          if (attempt < retries) continue;
        }
      }

      await emit({
        type: "step.failed",
        runId: opts.runId,
        stepId: step.id,
        agentId: cap.agentId,
        error: failure,
      });
      return { ok: false as const, error: failure };
    }));

    const failure = results.find((result) => !result.ok);
    if (failure) {
      await emit({ type: "plan.failed", runId: opts.runId, note: failure.error });
      break;
    }

    const goalResult = opts.plan.goal(state.outputs);
    if (goalResult.done) {
      await emit({ type: "plan.completed", runId: opts.runId });
      return state;
    }
  }

  if (state.status !== "failed" && state.status !== "completed") {
    const goalResult = opts.plan.goal(state.outputs);
    if (goalResult.done) {
      await emit({ type: "plan.completed", runId: opts.runId });
    } else {
      const blockedSteps = steps
        .filter((s) => !stepSettled(state, s, retryFailed) && !stepReady(state, s))
        .map((s) => ({
          stepId: s.id,
          missing: s.inputs.filter((k) => state.outputs[k] === undefined),
        }));
      const stepDiag = blockedSteps.map((b) => `${b.stepId} needs [${b.missing.join(", ")}]`).join("; ");
      const note = goalResult.blocked
        ?? (stepDiag || "no runnable steps and goal unsatisfied");
      await emit({ type: "plan.failed", runId: opts.runId, note });
    }
  }

  return state;
};
