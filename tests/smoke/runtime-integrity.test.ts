import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import test from "node:test";

import { jsonBranchStore, jsonlStore } from "../../src/adapters/jsonl.ts";
import { createRuntime } from "../../src/core/runtime.ts";

type CounterCmd = {
  readonly type: "counter.inc";
  readonly seq: number;
};

type CounterEvent = CounterCmd;

type CounterState = {
  readonly count: number;
};

const createTempDir = async (label: string): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));

test("smoke: single-stream concurrent writes preserve integrity", { timeout: 120_000 }, async () => {
  const dataDir = await createTempDir("receipt-smoke-integrity");

  try {
    const store = jsonlStore<CounterEvent>(dataDir);
    const branchStore = jsonBranchStore(dataDir);
    const runtime = createRuntime<CounterCmd, CounterEvent, CounterState>(
      store,
      branchStore,
      (cmd) => [cmd],
      (state) => ({ count: state.count + 1 }),
      { count: 0 }
    );

    const stream = "integrity";
    const writes = 200;

    await Promise.all(
      Array.from({ length: writes }, (_unused, seq) =>
        runtime.execute(stream, { type: "counter.inc", seq })
      )
    );

    const chain = await runtime.chain(stream);
    assert.equal(chain.length, writes, "unexpected receipt count");

    const result = await runtime.verify(stream);
    assert.equal(result.ok, true, `integrity failed: ${JSON.stringify(result)}`);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
