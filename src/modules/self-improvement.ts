// ============================================================================
// Self-Improvement Module - persisted, gated proposal lifecycle receipts
// ============================================================================

import type { Decide, Reducer } from "../core/types.js";

export type ImprovementArtifactType = "prompt_patch" | "policy_patch" | "harness_patch";
export type ProposalStatus = "created" | "validated" | "approved" | "applied" | "reverted";
export type ValidationStatus = "passed" | "failed";

export type SelfImprovementEvent =
  | {
      readonly type: "proposal.created";
      readonly proposalId: string;
      readonly artifactType: ImprovementArtifactType;
      readonly target: string;
      readonly patch: string;
      readonly createdBy?: string;
    }
  | {
      readonly type: "proposal.validated";
      readonly proposalId: string;
      readonly status: ValidationStatus;
      readonly report: string;
      readonly validatedBy?: string;
    }
  | {
      readonly type: "proposal.approved";
      readonly proposalId: string;
      readonly approvedBy?: string;
      readonly note?: string;
    }
  | {
      readonly type: "proposal.applied";
      readonly proposalId: string;
      readonly appliedBy?: string;
      readonly note?: string;
    }
  | {
      readonly type: "proposal.reverted";
      readonly proposalId: string;
      readonly revertedBy?: string;
      readonly reason?: string;
    };

export type SelfImprovementCmd = {
  readonly type: "emit";
  readonly event: SelfImprovementEvent;
  readonly eventId: string;
  readonly expectedPrev?: string;
};

export type ProposalRecord = {
  readonly id: string;
  readonly artifactType: ImprovementArtifactType;
  readonly target: string;
  readonly patch: string;
  readonly status: ProposalStatus;
  readonly validation?: {
    readonly status: ValidationStatus;
    readonly report: string;
    readonly validatedBy?: string;
    readonly ts: number;
  };
  readonly createdBy?: string;
  readonly approvedBy?: string;
  readonly appliedBy?: string;
  readonly revertedBy?: string;
  readonly note?: string;
  readonly updatedAt: number;
};

export type SelfImprovementState = {
  readonly proposals: Readonly<Record<string, ProposalRecord>>;
};

export const initial: SelfImprovementState = { proposals: {} };

export const decide: Decide<SelfImprovementCmd, SelfImprovementEvent> = (cmd) => [cmd.event];

const upsert = (state: SelfImprovementState, proposal: ProposalRecord): SelfImprovementState => ({
  ...state,
  proposals: {
    ...state.proposals,
    [proposal.id]: proposal,
  },
});

export const reduce: Reducer<SelfImprovementState, SelfImprovementEvent> = (state, event, ts) => {
  switch (event.type) {
    case "proposal.created":
      return upsert(state, {
        id: event.proposalId,
        artifactType: event.artifactType,
        target: event.target,
        patch: event.patch,
        status: "created",
        createdBy: event.createdBy,
        updatedAt: ts,
      });
    case "proposal.validated": {
      const prev = state.proposals[event.proposalId];
      if (!prev) throw new Error(`Invariant: no proposal ${event.proposalId} for ${event.type}`);
      return upsert(state, {
        ...prev,
        status: "validated",
        validation: {
          status: event.status,
          report: event.report,
          validatedBy: event.validatedBy,
          ts,
        },
        updatedAt: ts,
      });
    }
    case "proposal.approved": {
      const prev = state.proposals[event.proposalId];
      if (!prev) throw new Error(`Invariant: no proposal ${event.proposalId} for ${event.type}`);
      return upsert(state, {
        ...prev,
        status: "approved",
        approvedBy: event.approvedBy,
        note: event.note ?? prev.note,
        updatedAt: ts,
      });
    }
    case "proposal.applied": {
      const prev = state.proposals[event.proposalId];
      if (!prev) throw new Error(`Invariant: no proposal ${event.proposalId} for ${event.type}`);
      return upsert(state, {
        ...prev,
        status: "applied",
        appliedBy: event.appliedBy,
        note: event.note ?? prev.note,
        updatedAt: ts,
      });
    }
    case "proposal.reverted": {
      const prev = state.proposals[event.proposalId];
      if (!prev) throw new Error(`Invariant: no proposal ${event.proposalId} for ${event.type}`);
      return upsert(state, {
        ...prev,
        status: "reverted",
        revertedBy: event.revertedBy,
        note: event.reason ?? prev.note,
        updatedAt: ts,
      });
    }
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
};

