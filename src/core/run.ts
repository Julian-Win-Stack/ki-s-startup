// ============================================================================
// Run Protocol Helpers — durable execution defaults
// ============================================================================

import type { Chain, Reducer } from "./types.js";
import { fold } from "./chain.js";

export type RunStatus = "idle" | "running" | "failed" | "completed";

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

export const defaultShouldIndex = <Event extends RunEvent>(event: Event): boolean => {
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

export const deriveRunState = <Event extends RunEvent, State extends RunState>(
  chain: Chain<Event>,
  reducer: Reducer<State, Event>,
  initial: State
): State => fold(chain, reducer, initial);

export const resumeFromChain = <Event extends RunEvent, State extends RunState>(
  chain: Chain<Event>,
  reducer: Reducer<State, Event>,
  initial: State,
  runId: string
): { readonly state: State; readonly resume: boolean } => {
  const state = deriveRunState(chain, reducer, initial);
  const resume = chain.length > 0 && (!state.runId || state.runId === runId);
  return { state, resume };
};

export const getLatestRunId = <Event extends RunEvent>(
  chain: Chain<Event>,
  startType = "problem.set"
): string | undefined => {
  for (let i = chain.length - 1; i >= 0; i -= 1) {
    const event = chain[i].body;
    if (event.type === startType && event.runId) return event.runId;
  }
  return undefined;
};
