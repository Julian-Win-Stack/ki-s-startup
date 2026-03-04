import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createMemoryTools,
  decideMemory,
  initialMemoryState,
  reduceMemory,
  type MemoryCmd,
  type MemoryEvent,
  type MemoryState,
} from "../../src/adapters/memory-tools.ts";
import { jsonBranchStore, jsonlStore } from "../../src/adapters/jsonl.ts";
import { createRuntime } from "../../src/core/runtime.ts";

const mkTmp = async (label: string): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));

test("memory tools: commit/read/search/summarize/diff", async () => {
  const dir = await mkTmp("receipt-memory");
  try {
    const runtime = createRuntime<MemoryCmd, MemoryEvent, MemoryState>(
      jsonlStore<MemoryEvent>(dir),
      jsonBranchStore(dir),
      decideMemory,
      reduceMemory,
      initialMemoryState
    );
    const tools = createMemoryTools({ dir, runtime });
    const first = await tools.commit({
      scope: "theorem.run.demo",
      text: "Need stronger induction hypothesis.",
      tags: ["proof", "gap"],
    });
    await tools.commit({
      scope: "theorem.run.demo",
      text: "Verifier flagged missing base case.",
      tags: ["verifier"],
    });

    const read = await tools.read({ scope: "theorem.run.demo", limit: 10 });
    assert.equal(read.length, 2);

    const search = await tools.search({
      scope: "theorem.run.demo",
      query: "base case",
      limit: 5,
    });
    assert.equal(search.length, 1);
    assert.match(search[0]?.text ?? "", /base case/i);

    const summary = await tools.summarize({
      scope: "theorem.run.demo",
      query: "proof",
      limit: 5,
      maxChars: 500,
    });
    assert.match(summary.summary, /induction/i);

    const diff = await tools.diff({
      scope: "theorem.run.demo",
      fromTs: first.ts,
      toTs: Date.now(),
    });
    assert.equal(diff.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

