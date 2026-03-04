import { z } from "zod";

export const todoCmdFormSchema = z.object({
  text: z.string().optional(),
  type: z.string().optional(),
  id: z.string().optional(),
});

export const theoremRunFormSchema = z.object({
  problem: z.string().min(1),
  append: z.string().optional(),
  rounds: z.string().optional(),
  depth: z.string().optional(),
  memory: z.string().optional(),
  branch: z.string().optional(),
});

export const writerRunFormSchema = z.object({
  problem: z.string().min(1),
  append: z.string().optional(),
  parallel: z.string().optional(),
});

export const agentRunFormSchema = z.object({
  problem: z.string().min(1),
  maxIterations: z.string().optional(),
  maxToolOutputChars: z.string().optional(),
  memoryScope: z.string().optional(),
  workspace: z.string().optional(),
});

export const receiptInspectFormSchema = z.object({
  file: z.string().min(1),
  order: z.string().optional(),
  limit: z.string().optional(),
  depth: z.string().optional(),
  question: z.string().optional(),
});
