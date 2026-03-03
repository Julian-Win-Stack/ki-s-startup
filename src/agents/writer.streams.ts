// ============================================================================
// Writer Guild stream naming helpers
// ============================================================================

export const writerIndexStream = (base: string): string => base;

export const writerRunStream = (base: string, runId: string): string =>
  `${base}/runs/${runId}`;

export const writerBranchStream = (runStream: string, branchId: string): string =>
  `${runStream}/branches/${branchId}`;
