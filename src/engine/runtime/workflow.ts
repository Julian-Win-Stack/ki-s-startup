// ============================================================================
// Workflow runner - minimal orchestration harness
//
// Keeps workflows reusable while staying Receipt-native.
// ============================================================================

import type { Runtime } from "../../core/runtime.js";
import { fold } from "../../core/chain.js";
import type { Chain, Reducer } from "../../core/types.js";
import { action } from "../../sdk/actions.js";
import type { ReceiptDeclaration } from "../../sdk/receipt.js";
import { runAgentLoop, type ModernAgentSpec } from "./agent-loop.js";
import { isControlReceiptType } from "./control-receipts.js";

type RunStatus = "idle" | "running" | "failed" | "completed";

// ============================================================================
// Shared agent primitives
// ============================================================================

export const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const parseFormNum = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
};

export type AgentRunCommand = {
  readonly command: "steer" | "follow_up";
  readonly payload?: Record<string, unknown>;
};

export type AgentRunControl = {
  readonly jobId?: string;
  readonly checkAbort?: () => Promise<boolean>;
  readonly pullCommands?: () => Promise<ReadonlyArray<AgentRunCommand>>;
};

export const getLatestRunId = <Event extends { readonly type: string; readonly runId?: string }>(
  chain: Chain<Event>,
  startType = "problem.set"
): string | undefined => {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const event = chain[i].body;
    if (event.type === startType && event.runId) return event.runId;
  }
  return undefined;
};

export const runStream = (base: string, runId: string): string =>
  `${base}/runs/${runId}`;

export const branchStream = (base: string, branchId: string): string =>
  `${base}/branches/${branchId}`;

// ============================================================================
// Workflow types
// ============================================================================

export type RunEvent = {
  readonly type: string;
  readonly runId?: string;
};

export type RunState = {
  readonly runId?: string;
  readonly status?: RunStatus;
};

export type RunLifecycle<Ctx, Event extends RunEvent, State extends RunState, Config> = {
  readonly reducer: Reducer<State, Event>;
  readonly initial: State;
  readonly init: (ctx: Ctx, runId: string, config: Config) => Event[];
  readonly resume?: (ctx: Ctx, runId: string, state: State, config: Config) => Event[];
  readonly shouldIndex?: (event: Event) => boolean;
};

const defaultShouldIndex = <Event extends RunEvent>(event: Event): boolean => {
  switch (event.type) {
    case "problem.set":
    case "run.configured":
    case "solution.finalized":
      return true;
    case "run.status":
      return (event as { status?: RunStatus }).status !== "running";
    default:
      return false;
  }
};

const deriveRunState = <Event extends RunEvent, State extends RunState>(
  chain: Chain<Event>,
  reducer: Reducer<State, Event>,
  initial: State
): State => fold(chain, reducer, initial);

const resumeFromChain = <Event extends RunEvent, State extends RunState>(
  chain: Chain<Event>,
  reducer: Reducer<State, Event>,
  initial: State,
  runId: string
): { readonly state: State; readonly resume: boolean } => {
  const state = deriveRunState(chain, reducer, initial);
  const resume = chain.length > 0 && (!state.runId || state.runId === runId);
  return { state, resume };
};

export type EmitFn<Event> = (event: Event) => Promise<void>;

export type WorkflowContext<Deps, Event, State extends RunState = RunState> = Deps & {
  readonly stream: string;
  readonly runId: string;
  readonly emit: EmitFn<Event>;
  readonly emitIndex?: EmitFn<Event>;
  readonly now: () => number;
  readonly resume?: boolean;
  readonly state?: State;
};

export type WorkflowSpec<Deps, Config, Event extends RunEvent, State extends RunState = RunState> = {
  readonly id: string;
  readonly version: string;
  readonly lifecycle: RunLifecycle<Deps, Event, State, Config>;
  readonly run: (ctx: WorkflowContext<Deps, Event, State>, config: Config) => Promise<void>;
};

const stripControlReceipts = <Event extends RunEvent>(chain: Chain<{ readonly type: string }>): Chain<Event> =>
  chain.filter((receipt): receipt is Chain<Event>[number] => !isControlReceiptType(receipt.body.type));

export const createQueuedEmitter = <Cmd, Event, State>(opts: {
  readonly runtime: Runtime<Cmd, Event, State>;
  readonly stream: string;
  readonly wrap: (event: Event, meta: { readonly eventId: string }) => Cmd;
  readonly onEmit?: (event: Event) => void | Promise<void>;
  readonly onError?: (err: unknown) => void;
}): EmitFn<Event> => {
  let queue = Promise.resolve();
  let seq = 0;

  const nextEventId = () => {
    seq += 1;
    return `${opts.stream}:${Date.now().toString(36)}:${seq.toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
  };

  return (event: Event) => {
    const eventId = nextEventId();
    queue = queue
      .then(async () => {
        await opts.runtime.execute(opts.stream, opts.wrap(event, { eventId }));
        if (opts.onEmit) await opts.onEmit(event);
      })
      .catch((err) => {
        if (opts.onError) opts.onError(err);
        else console.error("emit failed", err);
        throw err;
      });
    return queue;
  };
};

export const runWorkflow = async <Cmd, Deps extends { runtime: Runtime<Cmd, Event, State> }, Config, Event extends RunEvent, State extends RunState>(
  spec: WorkflowSpec<Deps, Config, Event, State>,
  ctx: WorkflowContext<Deps, Event, State>,
  config: Config
): Promise<void> => {
  const shouldIndex = spec.lifecycle.shouldIndex ?? defaultShouldIndex;
  const emitIndex = ctx.emitIndex;
  const broadcast = "broadcast" in ctx && typeof ctx.broadcast === "function"
    ? ctx.broadcast as (() => void)
    : undefined;

  const toBody = (event: Event): Record<string, unknown> => {
    const { type: _type, ...body } = event as Event & Record<string, unknown>;
    return body;
  };

  const loopSpec = {
    id: `${spec.id}.workflow`,
    version: spec.version,
    receipts: {} as Record<string, ReceiptDeclaration<unknown>>,
    view: ({ on }) => {
      const runStartedCount = on("run.started").all().length;
      const actionCompletedCount = on("action.completed").all().length;
      return {
        settled: runStartedCount > 0 && actionCompletedCount >= runStartedCount,
      };
    },
    actions: () => [
      action("workflow.execute", {
        run: async ({ emit }) => {
          const chain = stripControlReceipts<Event>(await ctx.runtime.chain(ctx.stream) as Chain<{ readonly type: string }>);
          const { state: baseState, resume } = resumeFromChain(chain, spec.lifecycle.reducer, spec.lifecycle.initial, ctx.runId);

          const emitEvent: EmitFn<Event> = async (event) => {
            await emit(event.type, toBody(event));
            if (emitIndex && shouldIndex(event)) await emitIndex(event);
          };

          if (!resume) {
            const initEvents = spec.lifecycle.init(ctx, ctx.runId, config);
            for (const event of initEvents) await emitEvent(event);
          } else {
            const resumeEvents = spec.lifecycle.resume?.(ctx, ctx.runId, baseState, config) ?? [];
            for (const event of resumeEvents) await emitEvent(event);
            if (baseState.status === "completed") return;
          }

          const nextChain = stripControlReceipts<Event>(await ctx.runtime.chain(ctx.stream) as Chain<{ readonly type: string }>);
          const state = deriveRunState(nextChain, spec.lifecycle.reducer, spec.lifecycle.initial);
          await spec.run({ ...ctx, emit: emitEvent, resume, state }, config);
        },
      }),
    ],
    goal: ({ view }) => view.settled,
    maxIterations: 2,
    maxConcurrency: 1,
  } satisfies ModernAgentSpec<
    Record<string, ReceiptDeclaration<unknown>>,
    { readonly settled: boolean },
    Record<string, unknown>
  >;

  await runAgentLoop({
    spec: loopSpec,
    runtime: ctx.runtime,
    stream: ctx.stream,
    runId: ctx.runId,
    wrap: (event, meta) => ({
      type: "emit",
      event,
      eventId: meta.eventId,
      expectedPrev: meta.expectedPrev,
    }) as Cmd,
    deps: ctx as Deps & Record<string, unknown>,
    now: ctx.now,
    afterEmit: broadcast ? async () => { broadcast(); } : undefined,
  });
};
