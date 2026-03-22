import fs from "node:fs/promises";
import path from "node:path";

type RepoTopEntry = {
  readonly name: string;
  readonly kind: "dir" | "file" | "other";
};

type RepoScriptMap = Readonly<Record<string, string>>;

export type FactoryRepoExecutionLandscape = {
  readonly summary: string;
  readonly tooling: ReadonlyArray<string>;
  readonly authSurfaces: ReadonlyArray<string>;
  readonly policySurfaces: ReadonlyArray<string>;
  readonly guardrails: ReadonlyArray<string>;
  readonly notablePaths: ReadonlyArray<string>;
};

const uniq = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values.filter((value) => value.trim().length > 0))];

const topEntrySet = (entries: ReadonlyArray<RepoTopEntry>): ReadonlySet<string> =>
  new Set(entries.map((entry) => entry.name));

const hasAnyScriptMatch = (scripts: RepoScriptMap, patterns: ReadonlyArray<RegExp>): boolean =>
  Object.values(scripts).some((script) => patterns.some((pattern) => pattern.test(script)));

const fileExists = async (target: string): Promise<boolean> => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const collectTopEntries = async (repoRoot: string): Promise<ReadonlyArray<RepoTopEntry>> => {
  const entries = await fs.readdir(repoRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .map((entry) => ({
      name: entry.name,
      kind: (entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other") as RepoTopEntry["kind"],
    }))
    .slice(0, 80);
};

export const scanFactoryRepoExecutionLandscape = async (input: {
  readonly repoRoot: string;
  readonly packageScripts?: RepoScriptMap;
  readonly topEntries?: ReadonlyArray<RepoTopEntry>;
}): Promise<FactoryRepoExecutionLandscape> => {
  const entries = input.topEntries ?? await collectTopEntries(input.repoRoot);
  const names = topEntrySet(entries);
  const scripts = input.packageScripts ?? {};

  const notablePaths = uniq([
    names.has(".aws") ? ".aws" : "",
    names.has("terraform") ? "terraform" : "",
    names.has("terragrunt") ? "terragrunt" : "",
    names.has("infra") ? "infra" : "",
    names.has("infrastructure") ? "infrastructure" : "",
    names.has("cdk") ? "cdk" : "",
    names.has("pulumi") ? "pulumi" : "",
    names.has("helm") ? "helm" : "",
    names.has("charts") ? "charts" : "",
    names.has("k8s") ? "k8s" : "",
    names.has("kubernetes") ? "kubernetes" : "",
    names.has(".github") ? ".github" : "",
    await fileExists(path.join(input.repoRoot, "cdk.json")) ? "cdk.json" : "",
    await fileExists(path.join(input.repoRoot, "Pulumi.yaml")) ? "Pulumi.yaml" : "",
    await fileExists(path.join(input.repoRoot, "template.yaml")) ? "template.yaml" : "",
    await fileExists(path.join(input.repoRoot, "template.yml")) ? "template.yml" : "",
    await fileExists(path.join(input.repoRoot, "serverless.yml")) ? "serverless.yml" : "",
    await fileExists(path.join(input.repoRoot, "serverless.yaml")) ? "serverless.yaml" : "",
  ]).slice(0, 12);

  const tooling = uniq([
    (names.has(".aws") || hasAnyScriptMatch(scripts, [/\baws\b/i])) ? "aws-cli" : "",
    (names.has("terraform") || hasAnyScriptMatch(scripts, [/\bterraform\b/i])) ? "terraform" : "",
    (names.has("terragrunt") || hasAnyScriptMatch(scripts, [/\bterragrunt\b/i])) ? "terragrunt" : "",
    (names.has("cdk") || await fileExists(path.join(input.repoRoot, "cdk.json")) || hasAnyScriptMatch(scripts, [/\bcdk\b/i])) ? "aws-cdk" : "",
    (names.has("pulumi") || await fileExists(path.join(input.repoRoot, "Pulumi.yaml")) || hasAnyScriptMatch(scripts, [/\bpulumi\b/i])) ? "pulumi" : "",
    (names.has("helm") || names.has("charts") || hasAnyScriptMatch(scripts, [/\bhelm\b/i])) ? "helm" : "",
    (names.has("k8s") || names.has("kubernetes") || hasAnyScriptMatch(scripts, [/\bkubectl\b/i])) ? "kubectl" : "",
    (await fileExists(path.join(input.repoRoot, "template.yaml")) || await fileExists(path.join(input.repoRoot, "template.yml")) || hasAnyScriptMatch(scripts, [/\bsam\b/i, /\bcloudformation\b/i])) ? "cloudformation" : "",
    (await fileExists(path.join(input.repoRoot, "serverless.yml")) || await fileExists(path.join(input.repoRoot, "serverless.yaml")) || hasAnyScriptMatch(scripts, [/\bserverless\b/i, /\bsls\b/i])) ? "serverless" : "",
  ]);

  const authSurfaces = uniq([
    names.has(".aws") ? "Repository-local AWS config is present under .aws." : "",
    names.has(".github") ? "CI/CD identity and deployment access may be defined under .github workflows." : "",
    names.has("iam") ? "IAM-related code or notes exist under iam/." : "",
    names.has("policies") ? "Policy definitions exist under policies/." : "",
    notablePaths.includes("terraform") ? "Terraform modules may rely on provider credentials and remote state access." : "",
    tooling.includes("aws-cdk") ? "CDK workflows may assume AWS account, region, and bootstrap permissions." : "",
    tooling.includes("kubectl") ? "Kubernetes workflows may depend on kubeconfig or cluster-auth helpers." : "",
  ]);

  const policySurfaces = uniq([
    names.has("iam") ? "iam/" : "",
    names.has("policies") ? "policies/" : "",
    notablePaths.includes("terraform") ? "terraform/" : "",
    notablePaths.includes("terragrunt") ? "terragrunt/" : "",
    notablePaths.includes("cdk.json") ? "cdk.json" : "",
    notablePaths.includes("template.yaml") ? "template.yaml" : "",
    notablePaths.includes("template.yml") ? "template.yml" : "",
    notablePaths.includes("Pulumi.yaml") ? "Pulumi.yaml" : "",
    names.has(".github") ? ".github/workflows" : "",
  ]);

  const guardrails = uniq([
    tooling.includes("aws-cli") ? "Prefer scripted, idempotent AWS CLI collection over one-off shell history so evidence survives in the worktree." : "",
    policySurfaces.length > 0 ? "Check policy and infrastructure definitions before assuming a permission or deployment path." : "",
    names.has(".github") ? "Cross-check CI/CD workflows before inferring production deployment steps or required environment variables." : "",
    tooling.includes("terraform") || tooling.includes("terragrunt")
      ? "Treat stateful IaC commands as high-blast-radius; investigations should default to read/plan-style evidence unless the objective explicitly escalates."
      : "",
    tooling.includes("kubectl")
      ? "Cluster operations should capture namespace, context, and auth assumptions explicitly in worker reports."
      : "",
    "Mount the generated repo skills and current context pack before making permission-sensitive claims.",
  ]);

  const summary = [
    tooling.length
      ? `Execution tooling signals: ${tooling.join(", ")}.`
      : "No strong infrastructure-tooling signal was detected from the repo root.",
    authSurfaces.length
      ? `Auth surfaces: ${authSurfaces.slice(0, 3).join(" ")}`
      : "No explicit auth surface was detected in the repo root scan.",
    policySurfaces.length
      ? `Policy surfaces: ${policySurfaces.join(", ")}.`
      : "No explicit policy surface was detected in the repo root scan.",
  ].join(" ");

  return {
    summary,
    tooling,
    authSurfaces,
    policySurfaces,
    guardrails,
    notablePaths,
  };
};

export const renderFactoryRepoExecutionLandscapeSkill = (
  landscape: FactoryRepoExecutionLandscape,
): { readonly slug: string; readonly title: string; readonly content: string } => ({
  slug: "repo-execution-landscape",
  title: "Repo Execution And Permission Landscape",
  content: [
    "# Repo Execution And Permission Landscape",
    "",
    landscape.summary,
    "",
    "## Tooling Signals",
    ...(landscape.tooling.length ? landscape.tooling.map((item) => `- ${item}`) : ["- none detected"]),
    "",
    "## Auth Surfaces",
    ...(landscape.authSurfaces.length ? landscape.authSurfaces.map((item) => `- ${item}`) : ["- none detected"]),
    "",
    "## Policy Surfaces",
    ...(landscape.policySurfaces.length ? landscape.policySurfaces.map((item) => `- ${item}`) : ["- none detected"]),
    "",
    "## Notable Paths",
    ...(landscape.notablePaths.length ? landscape.notablePaths.map((item) => `- ${item}`) : ["- none detected"]),
    "",
    "## Guardrails",
    ...(landscape.guardrails.length ? landscape.guardrails.map((item) => `- ${item}`) : ["- none"]),
  ].join("\n"),
});
