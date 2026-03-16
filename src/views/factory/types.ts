import type {
  FactoryBoardProjection,
  FactoryComposeModel,
  FactoryDebugProjection,
  FactoryLiveProjection,
  FactoryObjectiveDetail,
  FactoryTaskView,
} from "../../services/factory-service.js";

export type {
  FactoryBoardProjection,
  FactoryComposeModel,
  FactoryDebugProjection,
  FactoryLiveProjection,
  FactoryObjectiveDetail,
  FactoryTaskView,
};

export type StreamEntryKind =
  | "objective_created"
  | "plan_adopted"
  | "task_dispatched"
  | "task_completed"
  | "task_failed"
  | "decision"
  | "blocked"
  | "merge"
  | "promotion"
  | "receipt"
  | "job"
  | "live";

export type StreamAction = {
  readonly label: string;
  readonly endpoint: string;
  readonly method?: "post" | "get";
  readonly variant?: "primary" | "ghost" | "danger";
};

export type StreamEntry = {
  readonly kind: StreamEntryKind;
  readonly title: string;
  readonly summary: string;
  readonly at: number;
  readonly taskId?: string;
  readonly candidateId?: string;
  readonly receiptHash?: string;
  readonly actions: ReadonlyArray<StreamAction>;
  readonly severity: "normal" | "success" | "warning" | "error" | "accent";
};

export type FactoryShellOpts = {
  readonly composeIsland: string;
  readonly boardIsland: string;
  readonly streamIsland: string;
  readonly contextIsland: string;
};
