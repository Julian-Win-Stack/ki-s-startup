// ============================================================================
// Receipt Runtime - planner-first agent surface
// ============================================================================

import type { Reducer } from "../../core/types.js";
import type { Runtime } from "../../core/runtime.js";
import type { RunEvent, RunLifecycle, RunState } from "../../core/run.js";
import type { PlannerEvent, PlannerState } from "../../modules/planner.js";
import { createQueuedEmitter, runWorkflow, type WorkflowContext } from "./workflow.js";
import { runReceiptPlanner, type CapabilitySpec, type PlanSpec } from "./planner.js";
import type { BranchPolicy, MemoryPolicy, MergePolicy } from "./policies.js";

type LifecycleShape<Deps, Event extends RunEvent, State extends RunState, Config> =
  Omit<RunLifecycle<Deps, Event, State, Config>, "reducer" | "initial">;

type PlannerConfig<State> = {
  readonly plannerState: (state: State) => PlannerState;
  readonly maxParallel?: number;
  readonly defaultTimeoutMs?: number;
  readonly defaultRetries?: number;
  readonly retryFailed?: boolean;
};

type CmdWrap<Cmd, Event> = {
  readonly wrap: (event: Event, meta: { readonly eventId: string }) => Cmd;
};

export type ReceiptAgentSpec<
  Cmd,
  Deps extends { runtime: Runtime<Cmd, Event, State> },
  Event extends RunEvent,
  State extends RunState,
  Config
> = {
  readonly id: string;
  readonly version: string;
  readonly reducer: Reducer<State, Event>;
  readonly initial: State;
  readonly lifecycle: LifecycleShape<Deps, Event, State, Config>;
  readonly plan: PlanSpec<WorkflowContext<Deps, Event, State>>;
  readonly capabilities?:
    | ReadonlyArray<CapabilitySpec<WorkflowContext<Deps, Event, State>>>
    | ((ctx: WorkflowContext<Deps, Event, State>, config: Config) => ReadonlyArray<CapabilitySpec<WorkflowContext<Deps, Event, State>>>);
  readonly planner?: PlannerConfig<State>;
  readonly run?: (ctx: WorkflowContext<Deps, Event, State>, config: Config) => Promise<void>;
  readonly policies?: {
    readonly memory?: MemoryPolicy<Event>;
    readonly branching?: BranchPolicy<Event>;
    readonly merge?: MergePolicy<Event>;
  };
  readonly command?: CmdWrap<Cmd, Event>;
};

export type RunReceiptAgentInput<
  Cmd,
  Deps extends { runtime: Runtime<Cmd, Event, State> },
  Event extends RunEvent,
  State extends RunState,
  Config
> = {
  readonly spec: ReceiptAgentSpec<Cmd, Deps, Event, State, Config>;
  readonly ctx: WorkflowContext<Deps, Event, State>;
  readonly config: Config;
};

const plannerHasStepId = (event: PlannerEvent): event is Extract<PlannerEvent, { readonly stepId: string }> =>
  "stepId" in event;

export const defineReceiptAgent = <
  Cmd,
  Deps extends { runtime: Runtime<Cmd, Event, State> },
  Event extends RunEvent,
  State extends RunState,
  Config
>(
  spec: ReceiptAgentSpec<Cmd, Deps, Event, State, Config>
): ReceiptAgentSpec<Cmd, Deps, Event, State, Config> => spec;

export const runReceiptAgent = async <
  Cmd,
  Deps extends { runtime: Runtime<Cmd, Event, State> },
  Event extends RunEvent,
  State extends RunState,
  Config
>(
  input: RunReceiptAgentInput<Cmd, Deps, Event, State, Config>
): Promise<void> => {
  const { spec, ctx, config } = input;
  const lifecycle: RunLifecycle<Deps, Event, State, Config> = {
    reducer: spec.reducer,
    initial: spec.initial,
    init: spec.lifecycle.init,
    resume: spec.lifecycle.resume,
    shouldIndex: spec.lifecycle.shouldIndex,
  };

  await runWorkflow<Cmd, Deps, Config, Event, State>(
    {
      id: spec.id,
      version: spec.version,
      lifecycle,
      run: async (workflowCtx, workflowConfig) => {
        if (spec.run) {
          await spec.run(workflowCtx, workflowConfig);
          return;
        }

        const planner = spec.planner;
        if (!planner) {
          throw new Error(`Receipt agent "${spec.id}" is missing "run" and "planner" configuration`);
        }

        const capabilities =
          typeof spec.capabilities === "function"
            ? spec.capabilities(workflowCtx, workflowConfig)
            : (spec.capabilities ?? spec.plan.capabilities);
        const plan: PlanSpec<WorkflowContext<Deps, Event, State>> = {
          ...spec.plan,
          capabilities,
        };
        const isolationByStep = new Map(capabilities.map((cap) => [cap.id, cap.isolation ?? "branch"]));
        const branchEmitters = new Map<string, (event: Event) => Promise<void>>();

        const ensureBranchEmitter = async (stepId: string) => {
          if (branchEmitters.has(stepId)) return;
          const wrap = spec.command?.wrap;
          if (!wrap) return;
          const branchStream = `${workflowCtx.stream}/branches/${stepId}`;
          const existing = await workflowCtx.runtime.branch(branchStream);
          if (!existing) {
            const forkAt = (await workflowCtx.runtime.chain(workflowCtx.stream)).length;
            await workflowCtx.runtime.fork(workflowCtx.stream, forkAt, branchStream);
          }
          const emitBranch = createQueuedEmitter({
            runtime: workflowCtx.runtime,
            stream: branchStream,
            wrap,
          });
          branchEmitters.set(stepId, emitBranch);
        };

        const emitPlannerEvent = async (event: PlannerEvent) => {
          await workflowCtx.emit(event as unknown as Event);
          if (!plannerHasStepId(event)) return;
          if (isolationByStep.get(event.stepId) !== "branch") return;
          await ensureBranchEmitter(event.stepId);
          const emitBranch = branchEmitters.get(event.stepId);
          if (!emitBranch) return;
          await emitBranch(event as unknown as Event);
        };

        const stateForPlanner = workflowCtx.state ?? spec.initial;
        await runReceiptPlanner({
          runId: workflowCtx.runId,
          ctx: workflowCtx,
          emit: emitPlannerEvent,
          plan,
          initial: planner.plannerState(stateForPlanner),
          maxParallel: planner.maxParallel,
          defaultTimeoutMs: planner.defaultTimeoutMs,
          defaultRetries: planner.defaultRetries,
          retryFailed: planner.retryFailed ?? Boolean(workflowCtx.resume),
        });
      },
    },
    ctx as WorkflowContext<Deps, Event, State>,
    config
  );
};
