// ============================================================================
// Branch Metadata Module - receipt-native branch index
// ============================================================================

import type { Branch, Decide, Reducer } from "../core/types.js";

export type BranchMetaEvent = {
  readonly type: "branch.meta.upsert";
  readonly branch: Branch;
};

export type BranchMetaCmd = {
  readonly type: "emit";
  readonly event: BranchMetaEvent;
};

export type BranchMetaState = {
  readonly branches: Readonly<Record<string, Branch>>;
};

export const initial: BranchMetaState = {
  branches: {},
};

export const decide: Decide<BranchMetaCmd, BranchMetaEvent> = (cmd) => [cmd.event];

export const reduce: Reducer<BranchMetaState, BranchMetaEvent> = (state, event) => {
  switch (event.type) {
    case "branch.meta.upsert":
      return {
        ...state,
        branches: {
          ...state.branches,
          [event.branch.name]: event.branch,
        },
      };
    default:
      return state;
  }
};
