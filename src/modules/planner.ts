// ============================================================================
// Planner Module - Input/Output scheduling receipts
// ============================================================================

export type PlanStep = {
  readonly id: string;
  readonly capId: string;
  readonly agentId?: string;
  readonly inputs: ReadonlyArray<string>;
  readonly outputs: ReadonlyArray<string>;
};

export type PlannerEvent =
  | {
      readonly type: "plan.configured";
      readonly runId: string;
      readonly steps: ReadonlyArray<PlanStep>;
      readonly note?: string;
    }
  | {
      readonly type: "plan.completed";
      readonly runId: string;
      readonly note?: string;
    }
  | {
      readonly type: "plan.failed";
      readonly runId: string;
      readonly note?: string;
    }
  | {
      readonly type: "step.ready";
      readonly runId: string;
      readonly stepId: string;
    }
  | {
      readonly type: "step.started";
      readonly runId: string;
      readonly stepId: string;
      readonly agentId?: string;
    }
  | {
      readonly type: "step.failed";
      readonly runId: string;
      readonly stepId: string;
      readonly agentId?: string;
      readonly error?: string;
    }
  | {
      readonly type: "step.completed";
      readonly runId: string;
      readonly stepId: string;
      readonly agentId?: string;
      readonly outputs: ReadonlyArray<string>;
    }
  | {
      readonly type: "state.patch";
      readonly runId: string;
      readonly stepId?: string;
      readonly patch: Record<string, string>;
    };

export type PlannerStepRecord = {
  readonly status: "ready" | "running" | "completed" | "failed";
  readonly outputs: ReadonlyArray<string>;
  readonly agentId?: string;
  readonly error?: string;
  readonly updatedAt: number;
};

export type PlannerState = {
  readonly steps: Readonly<Record<string, PlannerStepRecord>>;
  readonly outputs: Readonly<Record<string, string>>;
  readonly plan?: ReadonlyArray<PlanStep>;
  readonly status?: "running" | "completed" | "failed";
  readonly failureNote?: string;
};

export const initialPlannerState: PlannerState = {
  steps: {},
  outputs: {},
};

export const reducePlanner = (state: PlannerState, event: PlannerEvent, ts: number): PlannerState => {
  switch (event.type) {
    case "plan.configured":
      return {
        ...state,
        plan: event.steps,
        status: "running",
        failureNote: event.note,
      };
    case "plan.completed":
      return {
        ...state,
        status: "completed",
      };
    case "plan.failed":
      return {
        ...state,
        status: "failed",
        failureNote: event.note ?? state.failureNote,
      };
    case "step.ready":
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: {
            status: "ready",
            outputs: state.steps[event.stepId]?.outputs ?? [],
            agentId: state.steps[event.stepId]?.agentId,
            updatedAt: ts,
          },
        },
      };
    case "step.started":
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: {
            status: "running",
            outputs: state.steps[event.stepId]?.outputs ?? [],
            agentId: event.agentId ?? state.steps[event.stepId]?.agentId,
            updatedAt: ts,
          },
        },
      };
    case "step.failed":
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: {
            status: "failed",
            outputs: state.steps[event.stepId]?.outputs ?? [],
            agentId: event.agentId ?? state.steps[event.stepId]?.agentId,
            error: event.error ?? state.steps[event.stepId]?.error,
            updatedAt: ts,
          },
        },
      };
    case "step.completed":
      return {
        ...state,
        steps: {
          ...state.steps,
          [event.stepId]: {
            status: "completed",
            outputs: event.outputs,
            agentId: event.agentId ?? state.steps[event.stepId]?.agentId,
            updatedAt: ts,
          },
        },
      };
    case "state.patch":
      return {
        ...state,
        outputs: {
          ...state.outputs,
          ...event.patch,
        },
      };
    default:
      return state;
  }
};
