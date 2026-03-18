import { test, expect } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRuntime } from "../../src/core/runtime.ts";
import { jsonBranchStore, jsonlStore, createStreamLocator } from "../../src/adapters/jsonl.ts";
import { validatePlan } from "../../src/engine/runtime/plan-validate.ts";
import type { PlanSpec } from "../../src/engine/runtime/planner.ts";
import { reduce as reduceBranchMeta, initial as initialBranchMeta } from "../../src/modules/branch-meta.ts";
import { fold, receipt, verify } from "../../src/core/chain.ts";

const createTempDir = async (label: string): Promise<string> =>
  fs.mkdtemp(path.join(os.tmpdir(), `${label}-`));

test("runtime: plan validation rejects cycles and duplicate providers", () => {
  const plan: PlanSpec<{}> = {
    id: "demo",
    version: "1",
    goal: (outputs) => ({
      done: outputs["final"] !== undefined,
      blocked: outputs["final"] === undefined ? "final output not yet produced" : undefined,
    }),
    capabilities: [
      {
        id: "a",
        agentId: "agent-a",
        needs: ["b.out"],
        provides: ["a.out"],
        run: async () => ({ "a.out": "ok" }),
      },
      {
        id: "b",
        agentId: "agent-b",
        needs: ["a.out"],
        provides: ["b.out"],
        run: async () => ({ "b.out": "ok" }),
      },
      {
        id: "dup",
        agentId: "agent-dup",
        needs: [],
        provides: ["a.out"],
        run: async () => ({ "a.out": "dup" }),
      },
    ],
  };

  const result = validatePlan(plan);
  expect(result.ok).toBe(false);
  expect(result.errors.join("\n")).toMatch(/provided by both/i);
  expect(result.errors.join("\n")).toMatch(/dependency cycle/i);
});

test("runtime: emit eventId is idempotent and expectedPrev is enforced", async () => {
  const dataDir = await createTempDir("receipt-runtime-idempotent");
  try {
    type Event = { readonly type: "note"; readonly runId: string; readonly text: string };
    type Cmd = {
      readonly type: "emit";
      readonly event: Event;
      readonly eventId: string;
      readonly expectedPrev?: string;
    };

    const runtime = createRuntime<Cmd, Event, { count: number }>(
      jsonlStore<Event>(dataDir),
      jsonBranchStore(dataDir),
      (cmd) => [cmd.event],
      (state) => ({ count: state.count + 1 }),
      { count: 0 }
    );

    await runtime.execute("demo", {
      type: "emit",
      event: { type: "note", runId: "r1", text: "hello" },
      eventId: "evt-1",
    });
    await runtime.execute("demo", {
      type: "emit",
      event: { type: "note", runId: "r1", text: "hello duplicate" },
      eventId: "evt-1",
    });

    const chain = await runtime.chain("demo");
    expect(chain.length).toBe(1);

    expect(
      runtime.execute("demo", {
        type: "emit",
        event: { type: "note", runId: "r1", text: "bad prev" },
        eventId: "evt-2",
        expectedPrev: "not-the-head",
      }),
    ).rejects.toThrow(/Expected prev hash/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime: branch metadata is reconstructible from receipts only", async () => {
  const dataDir = await createTempDir("receipt-runtime-branches");
  try {
    type Cmd = { readonly type: "inc"; readonly seq: number };
    type Event = Cmd;
    const runtime = createRuntime<Cmd, Event, { count: number }>(
      jsonlStore<Event>(dataDir),
      jsonBranchStore(dataDir),
      (cmd) => [cmd],
      (state) => ({ count: state.count + 1 }),
      { count: 0 }
    );

    await runtime.execute("root", { type: "inc", seq: 1 });
    await runtime.execute("root", { type: "inc", seq: 2 });
    await runtime.fork("root", 2, "root/branches/a");
    await runtime.fork("root/branches/a", 2, "root/branches/a/branches/b");

    const listed = await runtime.branches();
    expect(listed.some((b) => b.name === "root/branches/a")).toBeTruthy();
    expect(listed.some((b) => b.name === "root/branches/a/branches/b")).toBeTruthy();

    const branchMetaStore = jsonlStore<{ type: "branch.meta.upsert"; branch: { name: string } }>(dataDir);
    const metaChain = await branchMetaStore.read("__meta/branches");
    const reconstructed = fold(metaChain, reduceBranchMeta, initialBranchMeta);
    expect(reconstructed.branches["root/branches/a"]).toBeTruthy();
    expect(reconstructed.branches["root/branches/a/branches/b"]).toBeTruthy();
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime: corrupted jsonl line fails explicitly", async () => {
  const dataDir = await createTempDir("receipt-runtime-corrupt");
  try {
    const stream = "corrupt";
    const store = jsonlStore<{ readonly type: "ok" }>(dataDir);
    const runtime = createRuntime<{ readonly type: "ok" }, { readonly type: "ok" }, { readonly ok: number }>(
      store,
      jsonBranchStore(dataDir),
      (cmd) => [cmd],
      (state) => ({ ok: state.ok + 1 }),
      { ok: 0 }
    );

    await runtime.execute(stream, { type: "ok" });
    const locator = createStreamLocator(dataDir);
    const file = await locator.fileFor(stream);
    await fs.appendFile(file, "{bad json line}\n", "utf-8");

    expect(store.read(stream)).rejects.toThrow(/Corrupt JSONL record/);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime: read/head/count/version on missing streams do not create manifest entries", async () => {
  const dataDir = await createTempDir("receipt-runtime-readonly");
  try {
    const store = jsonlStore<{ readonly type: "noop" }>(dataDir);
    await expect(store.read("missing")).resolves.toEqual([]);
    await expect(store.count("missing")).resolves.toBe(0);
    await expect(store.head("missing")).resolves.toBeUndefined();
    await expect(store.version?.("missing")).resolves.toBeUndefined();

    const manifestPath = path.join(dataDir, "_streams.json");
    await expect(fs.access(manifestPath)).rejects.toThrow();
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime: concurrent writers reject stale appends instead of corrupting the chain", async () => {
  const dataDir = await createTempDir("receipt-runtime-stale");
  try {
    type Event = { readonly type: "note"; readonly value: string };
    type Cmd = { readonly type: "emit"; readonly event: Event; readonly eventId: string };
    const baseStore = jsonlStore<Event>(dataDir);
    let waiting = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lockedStore = {
      ...baseStore,
      append: async (entry: Parameters<typeof baseStore.append>[0], expectedPrev?: string) => {
        waiting += 1;
        if (waiting === 2 && release) release();
        await gate;
        return baseStore.append(entry, expectedPrev);
      },
    };
    const makeRuntime = () => createRuntime<Cmd, Event, { readonly count: number }>(
      lockedStore,
      jsonBranchStore(dataDir),
      (cmd) => [cmd.event],
      (state) => ({ count: state.count + 1 }),
      { count: 0 },
    );

    const first = makeRuntime();
    const second = makeRuntime();
    const results = await Promise.allSettled([
      first.execute("race", { type: "emit", event: { type: "note", value: "a" }, eventId: "evt-a" }),
      second.execute("race", { type: "emit", event: { type: "note", value: "b" }, eventId: "evt-b" }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled").length).toBe(1);
    expect(results.filter((result) => result.status === "rejected").length).toBe(1);
    const chain = await jsonlStore<Event>(dataDir).read("race");
    expect(verify(chain)).toEqual({
      ok: true,
      count: 1,
      head: chain[0]?.hash,
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime: virtual branches preserve parent receipts and only persist branch-local writes", async () => {
  const dataDir = await createTempDir("receipt-runtime-virtual-branch");
  try {
    type Cmd = { readonly type: "inc"; readonly seq: number };
    type Event = Cmd;
    const store = jsonlStore<Event>(dataDir);
    const runtime = createRuntime<Cmd, Event, { readonly count: number }>(
      store,
      jsonBranchStore(dataDir),
      (cmd) => [cmd],
      (state) => ({ count: state.count + 1 }),
      { count: 0 },
    );
    const locator = createStreamLocator(dataDir);

    await runtime.execute("root", { type: "inc", seq: 1 });
    await runtime.execute("root", { type: "inc", seq: 2 });
    await runtime.fork("root", 2, "root/branches/a");

    const before = await runtime.chain("root/branches/a");
    expect(before.map((item) => item.body.seq)).toEqual([1, 2]);
    expect(await locator.fileForExisting("root/branches/a")).toBeUndefined();

    await runtime.execute("root/branches/a", { type: "inc", seq: 3 });

    const local = await store.read("root/branches/a");
    const materialized = await runtime.chain("root/branches/a");
    expect(local.length).toBe(1);
    expect(materialized.map((item) => item.body.seq)).toEqual([1, 2, 3]);
    expect(materialized[2]?.prev).toBe(materialized[1]?.hash);
    expect(await runtime.verify("root/branches/a")).toEqual({
      ok: true,
      count: 3,
      head: materialized[2]?.hash,
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test("runtime: copied legacy branch prefixes are trimmed and replayed against parent history", async () => {
  const dataDir = await createTempDir("receipt-runtime-legacy-branch");
  try {
    type Cmd = { readonly type: "inc"; readonly seq: number };
    type Event = Cmd;
    const store = jsonlStore<Event>(dataDir);
    const branchStore = jsonBranchStore(dataDir);
    const runtime = createRuntime<Cmd, Event, { readonly count: number }>(
      store,
      branchStore,
      (cmd) => [cmd],
      (state) => ({ count: state.count + 1 }),
      { count: 0 },
    );

    await runtime.execute("root", { type: "inc", seq: 1 });
    await runtime.execute("root", { type: "inc", seq: 2 });
    const parent = await runtime.chain("root");
    const branchName = "root/branches/legacy";
    await branchStore.save({
      name: branchName,
      parent: "root",
      forkAt: 2,
      createdAt: Date.now(),
    });

    const copyOne = receipt(branchName, undefined, parent[0]!.body, parent[0]!.ts);
    const copyTwo = receipt(branchName, copyOne.hash, parent[1]!.body, parent[1]!.ts);
    const legacyBranchEvent = receipt(branchName, copyTwo.hash, { type: "inc", seq: 3 }, Date.now());
    await store.append(copyOne, undefined);
    await store.append(copyTwo, copyOne.hash);
    await store.append(legacyBranchEvent, copyTwo.hash);

    const materialized = await runtime.chain(branchName);
    expect(materialized.map((item) => item.body.seq)).toEqual([1, 2, 3]);
    expect(materialized[0]?.hash).toBe(parent[0]?.hash);
    expect(materialized[1]?.hash).toBe(parent[1]?.hash);
    expect(materialized[2]?.id).toBe(legacyBranchEvent.id);
    expect(materialized[2]?.prev).toBe(parent[1]?.hash);
    expect(await runtime.verify(branchName)).toEqual({
      ok: true,
      count: 3,
      head: materialized[2]?.hash,
    });
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
