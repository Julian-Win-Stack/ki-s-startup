// ============================================================================
// Writer Guild Module - Planner-driven multi-agent writing receipts
// ============================================================================

import type { Decide, Reducer } from "../core/types.js";
import type { PlannerEvent, PlannerState } from "./planner.js";
import { initialPlannerState, reducePlanner } from "./planner.js";

export type WriterEvent =
  | {
      readonly type: "problem.set";
      readonly runId: string;
      readonly problem: string;
      readonly agentId?: string;
    }
  | {
      readonly type: "problem.appended";
      readonly runId: string;
      readonly append: string;
      readonly agentId?: string;
    }
  | {
      readonly type: "run.configured";
      readonly runId: string;
      readonly agentId?: string;
      readonly workflow: { id: string; version: string };
      readonly config: { readonly maxParallel: number };
      readonly model: string;
      readonly promptHash?: string;
      readonly promptPath?: string;
    }
  | {
      readonly type: "run.status";
      readonly runId: string;
      readonly status: "running" | "failed" | "completed";
      readonly agentId?: string;
      readonly note?: string;
    }
  | {
      readonly type: "solution.finalized";
      readonly runId: string;
      readonly agentId: string;
      readonly content: string;
      readonly confidence: number;
    }
  | {
      readonly type: "prompt.context";
      readonly runId: string;
      readonly agentId?: string;
      readonly stepId?: string;
      readonly title?: string;
      readonly content: string;
    }
  | PlannerEvent;

export type WriterCmd = {
  readonly type: "emit";
  readonly event: WriterEvent;
  readonly eventId: string;
  readonly expectedPrev?: string;
};

export type WriterState = {
  readonly runId?: string;
  readonly problem: string;
  readonly status: "idle" | "running" | "failed" | "completed";
  readonly statusNote?: string;
  readonly config?: {
    readonly maxParallel: number;
    readonly model: string;
    readonly promptHash?: string;
    readonly promptPath?: string;
    readonly workflowId: string;
    readonly workflowVersion: string;
    readonly updatedAt: number;
  };
  readonly planner: PlannerState;
  readonly solution?: { content: string; confidence: number; updatedAt: number };
};

export const initial: WriterState = {
  problem: "",
  status: "idle",
  planner: initialPlannerState,
};

export const decide: Decide<WriterCmd, WriterEvent> = (cmd) => [cmd.event];

const isPlannerEvent = (event: WriterEvent): event is PlannerEvent =>
  event.type === "plan.configured"
  || event.type === "plan.completed"
  || event.type === "plan.failed"
  || event.type === "step.ready"
  || event.type === "step.started"
  || event.type === "step.completed"
  || event.type === "step.failed"
  || event.type === "state.patch";

export const reduce: Reducer<WriterState, WriterEvent> = (state, event, ts) => {
  if (isPlannerEvent(event)) {
    return {
      ...state,
      planner: reducePlanner(state.planner, event, ts),
    };
  }

  switch (event.type) {
    case "problem.set":
      return {
        ...initial,
        runId: event.runId,
        problem: event.problem,
        status: "running",
      };
    case "problem.appended": {
      const append = event.append.trim();
      if (!append) return state;
      const base = state.problem.trim();
      const problem = base ? `${base}\n\n${append}` : append;
      return { ...state, problem };
    }
    case "run.configured":
      return {
        ...state,
        config: {
          maxParallel: event.config.maxParallel,
          model: event.model,
          promptHash: event.promptHash,
          promptPath: event.promptPath,
          workflowId: event.workflow.id,
          workflowVersion: event.workflow.version,
          updatedAt: ts,
        },
      };
    case "run.status":
      return {
        ...state,
        status: event.status,
        statusNote: event.note ?? state.statusNote,
      };
    case "solution.finalized":
      return {
        ...state,
        status: "completed",
        solution: {
          content: event.content,
          confidence: event.confidence,
          updatedAt: ts,
        },
      };
    default:
      return state;
  }
};
