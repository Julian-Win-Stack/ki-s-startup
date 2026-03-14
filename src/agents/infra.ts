import path from "node:path";
import { spawn } from "node:child_process";

import {
  AGENT_DEFAULT_CONFIG,
  normalizeAgentConfig,
  runAgent,
  type AgentRunConfig,
  type AgentRunInput,
  type AgentRunResult,
  type AgentToolExecutor,
  type AgentToolResult,
} from "./agent.js";
import type { InfraPromptConfig } from "../prompts/infra.js";

export const INFRA_WORKFLOW_ID = "infra-v1";
export const INFRA_WORKFLOW_VERSION = "1.0.0";

export type InfraRunConfig = AgentRunConfig;

export const INFRA_DEFAULT_CONFIG: InfraRunConfig = {
  ...AGENT_DEFAULT_CONFIG,
  memoryScope: "infra",
};

export type InfraRunInput = Omit<AgentRunInput, "config" | "prompts"> & {
  readonly config: InfraRunConfig;
  readonly prompts: InfraPromptConfig;
};

const resolveWorkspacePath = (root: string, rawPath: string): string => {
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, rawPath);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`path escapes workspace: ${rawPath}`);
  }
  return resolved;
};

const summarizeAwsOutput = (command: string, code: number | null, signal: NodeJS.Signals | null, stdout: string, stderr: string): AgentToolResult => {
  const output = [
    `command: ${command}`,
    `exit: ${code ?? "null"} signal: ${signal ?? "none"}`,
    stdout ? `stdout:\n${stdout}` : "",
    stderr ? `stderr:\n${stderr}` : "",
  ].filter(Boolean).join("\n\n");

  return {
    output,
    summary: `${command} -> exit ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`,
  };
};

const createAwsCliTool = (workspaceRoot: string): AgentToolExecutor =>
  async (input) => {
    const rawArgs = Array.isArray(input.args) ? input.args : undefined;
    const args = rawArgs?.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()) ?? [];
    if (args.length === 0) {
      throw new Error("aws.cli.args must be a non-empty array of strings");
    }
    const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs)
      ? Math.max(500, Math.min(Math.floor(input.timeoutMs), 120_000))
      : 30_000;
    const cwd = typeof input.cwd === "string" && input.cwd.trim().length > 0
      ? resolveWorkspacePath(workspaceRoot, input.cwd.trim())
      : workspaceRoot;
    const command = `aws ${args.join(" ")}`;

    return new Promise<AgentToolResult>((resolve, reject) => {
      const child = spawn("aws", args, {
        cwd,
        env: process.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
      }, timeoutMs);

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const errno = err as NodeJS.ErrnoException;
        if (errno.code === "ENOENT") {
          reject(new Error("AWS CLI is not installed or not on PATH"));
          return;
        }
        reject(err);
      });

      child.on("close", (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(summarizeAwsOutput(command, code, signal, stdout, stderr));
      });
    });
  };

export const normalizeInfraConfig = (input: Partial<InfraRunConfig>): InfraRunConfig => {
  const normalized = normalizeAgentConfig(input);
  return {
    ...normalized,
    memoryScope: typeof input.memoryScope === "string" && input.memoryScope.trim().length > 0
      ? input.memoryScope.trim()
      : INFRA_DEFAULT_CONFIG.memoryScope,
  };
};

export const runInfra = async (input: InfraRunInput): Promise<AgentRunResult> =>
  {
    const resolvedWorkspaceRoot = path.resolve(
      path.isAbsolute(input.config.workspace)
        ? input.config.workspace
        : path.join(input.workspaceRoot, input.config.workspace)
    );

    return runAgent({
      ...input,
      config: input.config,
      prompts: input.prompts,
      workflowId: INFRA_WORKFLOW_ID,
      workflowVersion: INFRA_WORKFLOW_VERSION,
      extraToolSpecs: {
        "aws.cli": "{\"args\": string[], \"cwd\"?: string, \"timeoutMs\"?: number} — Execute AWS CLI without a shell. Example: {\"args\":[\"sts\",\"get-caller-identity\"]}.",
        ...(input.extraToolSpecs ?? {}),
      },
      extraTools: {
        "aws.cli": createAwsCliTool(resolvedWorkspaceRoot),
        ...(input.extraTools ?? {}),
      },
    });
  };
