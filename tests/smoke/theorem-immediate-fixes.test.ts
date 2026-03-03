import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { jsonBranchStore, jsonlStore } from "../../src/adapters/jsonl.ts";
import {
  runTheoremGuild,
} from "../../src/agents/theorem.ts";
import { theoremRunStream } from "../../src/agents/theorem.streams.ts";
import type { Chain } from "../../src/core/types.ts";
import { createRuntime } from "../../src/core/runtime.ts";
import type { TheoremEvent } from "../../src/modules/theorem.ts";
import {
  decide as decideTheorem,
  reduce as reduceTheorem,
  initial as initialTheorem,
  type TheoremCmd,
  type TheoremState,
} from "../../src/modules/theorem.ts";
import { computeWeights, pairKey } from "../../src/agents/theorem.rebracket.ts";
import { evaluateRoundRebracketEvidence } from "../../src/agents/theorem.evidence.ts";
import { loadTheoremPrompts } from "../../src/prompts/theorem.ts";
import {
  callWithStructuredRetries,
  fallbackOrchestratorDecision,
  parseVerifyPayload,
  fallbackVerifyPayload,
} from "../../src/agents/theorem.structured.ts";

const mkReceipt = (body: TheoremEvent, ts: number): Chain<TheoremEvent>[number] => ({
  id: `id_${ts}`,
  ts,
  stream: "theorem/runs/r1",
  body,
  hash: `hash_${ts}`,
});

test("theorem: structured retry recovers valid JSON on retry", async () => {
  let calls = 0;
  const result = await callWithStructuredRetries({
    llmText: async () => {
      calls += 1;
      return calls === 1
        ? "not json"
        : "{\"status\":\"valid\",\"notes\":[\"step references are sound\"]}";
    },
    user: "verify",
    parse: parseVerifyPayload,
    fallback: fallbackVerifyPayload,
    retries: 1,
  });

  assert.equal(result.parsed, true);
  assert.equal(result.attempts, 2);
  assert.equal(result.value.status, "valid");
  assert.equal(calls, 2);
});

test("theorem: fallback orchestrator decision detects done token", () => {
  const decision = fallbackOrchestratorDecision("Looks complete; done.");
  assert.equal(decision.action, "done");
});

test("theorem: round evidence gates rebracketing with branchThreshold", () => {
  const runId = "r1";
  const chain: Chain<TheoremEvent> = [
    mkReceipt({
      type: "attempt.proposed",
      runId,
      claimId: "attempt_r1_a",
      agentId: "explorer_a",
      content: "Attempt A",
    }, 1),
    mkReceipt({
      type: "attempt.proposed",
      runId,
      claimId: "attempt_r1_b",
      agentId: "explorer_b",
      content: "Attempt B",
    }, 2),
    mkReceipt({
      type: "critique.raised",
      runId,
      claimId: "critique_r1_1",
      agentId: "skeptic",
      targetClaimId: "attempt_r1_a",
      content: "Issue in step 2",
    }, 3),
    mkReceipt({
      type: "critique.raised",
      runId,
      claimId: "critique_r1_2",
      agentId: "skeptic",
      targetClaimId: "attempt_r1_a",
      content: "Issue in assumption",
    }, 4),
  ];

  const lowThreshold = evaluateRoundRebracketEvidence(chain, 1, 1);
  const highThreshold = evaluateRoundRebracketEvidence(chain, 1, 5);

  assert.equal(lowThreshold.shouldRebracket, true);
  assert.equal(highThreshold.shouldRebracket, false);
  assert.ok(lowThreshold.score > highThreshold.score - 0.0001);
});

test("theorem: summary uses contribute to pod-pair weights", () => {
  const runId = "r1";
  const chain: Chain<TheoremEvent> = [
    mkReceipt({
      type: "attempt.proposed",
      runId,
      claimId: "attempt_r1_a",
      agentId: "explorer_a",
      content: "Attempt A",
    }, 1),
    mkReceipt({
      type: "attempt.proposed",
      runId,
      claimId: "attempt_r1_b",
      agentId: "explorer_b",
      content: "Attempt B",
    }, 2),
    mkReceipt({
      type: "summary.made",
      runId,
      claimId: "merge_r1_1",
      agentId: "synthesizer",
      bracket: "(A o B)",
      content: "Merged",
      uses: ["attempt_r1_a", "attempt_r1_b"],
    }, 3),
  ];

  const weights = computeWeights(chain);
  assert.equal(weights.get(pairKey("A", "B")), 1);
});

test("theorem: structured phases run end-to-end with mocked JSON responses", { timeout: 120_000 }, async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "receipt-theorem-structured-"));
  const oldPassK = process.env.THEOREM_PASS_K;
  process.env.THEOREM_PASS_K = "1";

  try {
    const runtime = createRuntime<TheoremCmd, TheoremEvent, TheoremState>(
      jsonlStore<TheoremEvent>(dataDir),
      jsonBranchStore(dataDir),
      decideTheorem,
      reduceTheorem,
      initialTheorem
    );
    const prompts = loadTheoremPrompts();
    const llmText = async (opts: { system?: string; user: string }): Promise<string> => {
      const user = opts.user;
      if (user.includes("\"action\": \"continue\" | \"done\"")) {
        return JSON.stringify({
          action: "continue",
          reason: "keep going",
          skip_lemma: false,
          skip_critique: false,
          skip_patch: false,
          skip_merge: false,
          focus: {},
        });
      }
      if (user.includes("\"attempt\": \"full attempt text\"")) {
        return JSON.stringify({
          attempt: "Step 1: Let x = x.\nStep 2: Therefore the statement holds.",
          lemmas: ["L1: Reflexivity of equality"],
          gaps: [],
        });
      }
      if (user.includes("\"lemmas\": [") && user.includes("\"statement\"")) {
        return JSON.stringify({
          lemmas: [{ label: "L1", statement: "For any x, x = x.", usage: "Step 1" }],
        });
      }
      if (user.includes("\"issues\": [")) {
        return JSON.stringify({ issues: [], summary: "No issues found." });
      }
      if (user.includes("\"patch\": \"patched proof text\"")) {
        return JSON.stringify({ patch: "No changes required.", remaining_gaps: [] });
      }
      if (user.includes("\"summary\": \"merged summary\"")) {
        return JSON.stringify({ summary: "Merged proof summary.", gaps: [] });
      }
      if (user.includes("\"status\": \"valid | needs | false\"")) {
        return JSON.stringify({ status: "valid", notes: ["Proof is logically valid."] });
      }
      if (user.includes("\"proof\": \"final proof text\"") || user.includes("\"proof\": \"revised proof text\"")) {
        return JSON.stringify({
          proof: "Proof:\nStep 1: x = x by reflexivity.\nConclusion.",
          confidence: 0.9,
          gaps: [],
        });
      }
      return "{}";
    };

    const runId = `run_${Date.now()}_structured`;
    await runTheoremGuild({
      stream: "theorem",
      runId,
      problem: "Prove x = x",
      config: { rounds: 1, maxDepth: 1, memoryWindow: 20, branchThreshold: 2 },
      runtime,
      prompts,
      llmText,
      model: "gpt-4o",
      apiReady: true,
    });

    const chain = await runtime.chain(theoremRunStream("theorem", runId));
    assert.ok(chain.some((r) => r.body.type === "solution.finalized"));
    assert.ok(
      chain.some((r) => r.body.type === "verification.report" && r.body.status === "valid"),
      "expected valid verifier report"
    );
  } finally {
    if (oldPassK === undefined) delete process.env.THEOREM_PASS_K;
    else process.env.THEOREM_PASS_K = oldPassK;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
