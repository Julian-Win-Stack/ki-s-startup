// ============================================================================
// Receipt Runtime Policies - explicit, composable, auditable
// ============================================================================

import type { Chain } from "../../core/types.js";

export type MemoryPhase = "attempt" | "lemma" | "critique" | "patch" | "merge";

export type MemoryPolicy<Event = unknown, Opts = unknown> = {
  readonly budget: (phase: MemoryPhase) => number;
  readonly select: (chain: Chain<Event>, opts: Opts) => string;
};

export type BranchPolicy<Event = unknown> = {
  readonly shouldFork: (chain: Chain<Event>, round: number) => boolean;
  readonly branchName: (runId: string, agentId: string, round: number) => string;
};

export type MergePolicy<Event = unknown> = {
  readonly mergeOrder: (chain: Chain<Event>, current: string) => { readonly bracket: string; readonly note?: string };
};
