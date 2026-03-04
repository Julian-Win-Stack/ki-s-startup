// ============================================================================
// Receipt Runtime Plan Validation
// ============================================================================

import type { PlanSpec } from "./planner.js";

export type PlanValidationResult = {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
  readonly topologicalOrder: ReadonlyArray<string>;
};

export type PlanValidationOptions = {
  readonly initialKeys?: ReadonlyArray<string>;
};

export const validatePlan = <Ctx>(
  plan: PlanSpec<Ctx>,
  options: PlanValidationOptions = {}
): PlanValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const initialKeys = new Set(options.initialKeys ?? []);

  const byId = new Map<string, PlanSpec<Ctx>["capabilities"][number]>();
  const providerByOutput = new Map<string, string>();

  for (const cap of plan.capabilities) {
    if (byId.has(cap.id)) {
      errors.push(`Duplicate capability id "${cap.id}"`);
      continue;
    }
    byId.set(cap.id, cap);
    for (const output of cap.provides) {
      const existing = providerByOutput.get(output);
      if (existing && existing !== cap.id) {
        errors.push(`Output "${output}" is provided by both "${existing}" and "${cap.id}"`);
      } else {
        providerByOutput.set(output, cap.id);
      }
    }
  }

  for (const cap of plan.capabilities) {
    for (const need of cap.needs) {
      const provided = providerByOutput.has(need);
      if (!provided && !initialKeys.has(need)) {
        errors.push(`Capability "${cap.id}" needs "${need}" but no provider exists`);
      }
    }
  }

  const allOutputs = new Set<string>();
  for (const cap of plan.capabilities) {
    for (const output of cap.provides) allOutputs.add(output);
  }
  for (const key of initialKeys) allOutputs.add(key);
  if (allOutputs.size === 0 && plan.capabilities.length > 0) {
    errors.push("Plan capabilities produce no outputs");
  }

  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const cap of plan.capabilities) {
    incoming.set(cap.id, new Set());
    outgoing.set(cap.id, new Set());
  }
  for (const cap of plan.capabilities) {
    for (const need of cap.needs) {
      const provider = providerByOutput.get(need);
      if (!provider) continue;
      if (provider === cap.id) {
        errors.push(`Capability "${cap.id}" both needs and provides "${need}"`);
        continue;
      }
      incoming.get(cap.id)?.add(provider);
      outgoing.get(provider)?.add(cap.id);
    }
  }

  const queue: string[] = [...incoming.entries()]
    .filter(([, deps]) => deps.size === 0)
    .map(([id]) => id);
  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    order.push(current);
    const edges = outgoing.get(current) ?? new Set<string>();
    for (const next of edges) {
      const deps = incoming.get(next);
      if (!deps) continue;
      deps.delete(current);
      if (deps.size === 0) queue.push(next);
    }
  }
  if (order.length !== plan.capabilities.length) {
    errors.push("Plan graph contains at least one dependency cycle");
  }

  if (plan.capabilities.length === 0) {
    warnings.push("Plan has no capabilities");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    topologicalOrder: order,
  };
};
