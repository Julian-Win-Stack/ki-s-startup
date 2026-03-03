// ============================================================================
// Checkpoint helpers - optional fold acceleration
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

import type { Chain, Reducer } from "./types.js";

export type Checkpoint<S> = {
  readonly stream: string;
  readonly index: number;
  readonly state: S;
  readonly updatedAt: number;
};

export type CheckpointStore<S> = {
  readonly get: (stream: string) => Promise<Checkpoint<S> | undefined>;
  readonly save: (checkpoint: Checkpoint<S>) => Promise<void>;
};

export type FoldCheckpointOptions<S> = {
  readonly interval?: number;
  readonly checkpoint?: CheckpointStore<S>;
};

const sha256 = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

export const memoryCheckpointStore = <S>(): CheckpointStore<S> => {
  const entries = new Map<string, Checkpoint<S>>();
  return {
    get: async (stream) => entries.get(stream),
    save: async (checkpoint) => {
      entries.set(checkpoint.stream, checkpoint);
    },
  };
};

export const fileCheckpointStore = <S>(dir: string): CheckpointStore<S> => {
  fs.mkdirSync(dir, { recursive: true });
  const fileFor = (stream: string) => path.join(dir, `${sha256(stream).slice(0, 24)}.checkpoint.json`);
  return {
    get: async (stream) => {
      const file = fileFor(stream);
      try {
        const raw = await fs.promises.readFile(file, "utf-8");
        return JSON.parse(raw) as Checkpoint<S>;
      } catch {
        return undefined;
      }
    },
    save: async (checkpoint) => {
      const file = fileFor(checkpoint.stream);
      await fs.promises.writeFile(file, JSON.stringify(checkpoint), "utf-8");
    },
  };
};

export const foldWithCheckpoint = async <S, B>(
  stream: string,
  chain: Chain<B>,
  reducer: Reducer<S, B>,
  initial: S,
  options: FoldCheckpointOptions<S> = {}
): Promise<S> => {
  const interval = Math.max(1, options.interval ?? 1000);
  const cpStore = options.checkpoint;
  const checkpoint = cpStore ? await cpStore.get(stream) : undefined;

  let state = initial;
  let startAt = 0;
  if (checkpoint && checkpoint.index <= chain.length) {
    state = checkpoint.state;
    startAt = checkpoint.index;
  }

  for (let i = startAt; i < chain.length; i += 1) {
    const r = chain[i];
    state = reducer(state, r.body, r.ts);
    if (!cpStore) continue;
    const index = i + 1;
    if (index % interval === 0 || index === chain.length) {
      await cpStore.save({
        stream,
        index,
        state,
        updatedAt: Date.now(),
      });
    }
  }
  return state;
};
