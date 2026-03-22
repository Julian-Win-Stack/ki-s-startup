import type { FactoryObjectiveMode } from "../modules/factory";
import type { FactoryCloudExecutionContext, FactoryCloudProvider } from "./factory-cloud-context";

const INFRASTRUCTURE_PROFILE_ID = "infrastructure";
const BUCKET_PROMPT_RE = /\b(bucket|buckets|s3)\b/i;
const INVENTORY_PROMPT_RE = /\b(how many|count|list|show|inventory|enumerate|what are|which)\b/i;
const COST_PROMPT_RE = /\b(cost|costs|pricing|price|spend)\b/i;

export type InfrastructureDecomposedTask = {
  readonly taskId: string;
  readonly title: string;
  readonly prompt: string;
  readonly workerType: string;
  readonly dependsOn: ReadonlyArray<string>;
};

export const infrastructureDefaultsToAws = (profileId: string | undefined): boolean =>
  profileId === INFRASTRUCTURE_PROFILE_ID;

const isSimpleAwsBucketInvestigation = (
  objectivePrompt: string,
  preferredProvider?: FactoryCloudProvider,
): boolean => {
  if ((preferredProvider ?? "aws") !== "aws") return false;
  return BUCKET_PROMPT_RE.test(objectivePrompt) && INVENTORY_PROMPT_RE.test(objectivePrompt);
};

export const buildInfrastructureDecompositionGuidance = (input: {
  readonly profileId: string | undefined;
  readonly objectiveMode: FactoryObjectiveMode;
  readonly objectivePrompt: string;
  readonly preferredProvider?: FactoryCloudProvider;
}): ReadonlyArray<string> => {
  if (!infrastructureDefaultsToAws(input.profileId) || input.objectiveMode !== "investigation") return [];
  const lines = [
    "For routine AWS inventory or counting requests against one resource family, prefer a single Codex task that writes a deterministic script, runs it, and interprets the result.",
    "Do not split simple AWS S3 inventory into separate provider-resolution, methodology, and synthesis tasks.",
    "Only create multiple tasks when the objective clearly requires multi-service correlation, reconciliation, fleet-wide fanout, or materially different evidence streams.",
  ];
  return isSimpleAwsBucketInvestigation(input.objectivePrompt, input.preferredProvider)
    ? [
        ...lines,
        "For S3 bucket questions, keep the plan to one AWS task unless the prompt explicitly asks for cross-account, multi-region, or fleet-wide analysis.",
      ]
    : lines;
};

export const renderInfrastructureTaskExecutionGuidance = (input: {
  readonly profileId: string | undefined;
  readonly objectiveMode: FactoryObjectiveMode;
  readonly cloudExecutionContext: FactoryCloudExecutionContext;
}): ReadonlyArray<string> => {
  if (!infrastructureDefaultsToAws(input.profileId) || input.objectiveMode !== "investigation") return [];
  const provider = input.cloudExecutionContext.preferredProvider ?? "aws";
  return [
    `## Script-First Execution`,
    `For infrastructure CLI investigations, prefer a deterministic script over ad hoc one-off commands.`,
    `Write the script in the current worktree, make it emit machine-readable output when practical, and fail fast on CLI, auth, or network errors.`,
    `Run the script from the worktree before interpreting the result, and base the report on the script output rather than memory or speculation.`,
    `Record the script path and invocation in report.scriptsRun so the operator can rerun the exact evidence path.`,
    ...(provider === "aws"
      ? [`For AWS tasks, capture \`aws sts get-caller-identity\` in the script first so account scope is explicit in the evidence.`]
      : []),
  ];
};

export const normalizeInfrastructureInvestigationTasks = (input: {
  readonly profileId: string | undefined;
  readonly objectiveMode: FactoryObjectiveMode;
  readonly objectivePrompt: string;
  readonly preferredProvider?: FactoryCloudProvider;
  readonly tasks: ReadonlyArray<InfrastructureDecomposedTask>;
}): ReadonlyArray<InfrastructureDecomposedTask> => {
  if (!infrastructureDefaultsToAws(input.profileId) || input.objectiveMode !== "investigation") return input.tasks;
  if (!isSimpleAwsBucketInvestigation(input.objectivePrompt, input.preferredProvider)) return input.tasks;
  const wantsCosts = COST_PROMPT_RE.test(input.objectivePrompt);
  const primary = input.tasks[0];
  return [{
    taskId: primary?.taskId ?? "task_01",
    title: wantsCosts
      ? "Inventory S3 buckets and summarize available bucket cost signals"
      : "Inventory S3 buckets and report the authoritative bucket count",
    prompt: wantsCosts
      ? "Write a deterministic script in the worktree that uses AWS CLI to capture the active caller identity, list S3 buckets for the mounted AWS account, and emit machine-readable output with bucket names and total count. Extend the same script to query any directly available per-bucket cost signals, and clearly distinguish verified live cost data from unavailable or estimated values. Run the script, interpret the results in plain language, and report hard CLI/auth/network failures exactly."
      : "Write a deterministic script in the worktree that uses AWS CLI to capture the active caller identity, list S3 buckets for the mounted AWS account, and emit machine-readable output with bucket names and total count. Run the script, interpret the results in plain language, and report hard CLI/auth/network failures exactly. Prefer the script output over ad hoc one-off commands.",
    workerType: primary?.workerType ?? "codex",
    dependsOn: [],
  }];
};
