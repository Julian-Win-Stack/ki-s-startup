import type { AgentRunInput, AgentRunResult } from "./agent.js";
import type { JsonlQueue } from "../adapters/jsonl-queue.js";
import type { FactoryService } from "../services/factory-service.js";
import type { CodexExecutor, CodexRunControl } from "../adapters/codex-executor.js";
import type { MemoryTools } from "../adapters/memory-tools.js";
import type { ZodTypeAny, infer as ZodInfer } from "zod";
import {
  runFactoryChat,
  normalizeFactoryChatConfig,
  runFactoryCodexJob,
  type FactoryChatRunInput,
  type FactoryChatRunConfig,
  FACTORY_CHAT_DEFAULT_CONFIG,
} from "./factory-chat.js";
import {
  runCodexSupervisor,
  type CodexSupervisorRunInput,
} from "./codex-supervisor.js";

export {
  runFactoryCodexJob,
  normalizeFactoryChatConfig,
  type FactoryChatRunConfig,
  FACTORY_CHAT_DEFAULT_CONFIG,
};

export type OrchestratorRunInput = AgentRunInput & {
  readonly queue: JsonlQueue;
  readonly dataDir?: string;
  readonly factoryService?: FactoryService;
  readonly repoRoot?: string;
  readonly profileRoot?: string;
  readonly objectiveId?: string;
  readonly profileId?: string;
  readonly continuationDepth?: number;
  readonly supervisorSessionId?: string;
  readonly llmStructured?: <Schema extends ZodTypeAny>(opts: {
    readonly system?: string;
    readonly user: string;
    readonly schema: Schema;
    readonly schemaName: string;
  }) => Promise<{ readonly parsed: ZodInfer<Schema>; readonly raw: string }>;
};

export const runOrchestrator = async (input: OrchestratorRunInput): Promise<AgentRunResult> => {
  const hasFactoryMode = Boolean(input.factoryService) && Boolean(input.repoRoot) && Boolean(input.llmStructured);

  if (hasFactoryMode) {
    return runFactoryChat({
      ...input,
      config: input.config as FactoryChatRunConfig,
      factoryService: input.factoryService!,
      repoRoot: input.repoRoot!,
      llmStructured: input.llmStructured!,
    } as FactoryChatRunInput);
  }

  return runCodexSupervisor({
    ...input,
    supervisorSessionId: input.supervisorSessionId,
  } as CodexSupervisorRunInput);
};
