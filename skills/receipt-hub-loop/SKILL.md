---
name: receipt-hub-loop
description: Use when working on the Receipt repo's Git-first hub objective loop, especially hub objectives, Codex worker integration, Git/worktree hygiene, objective review and merge flow, or debugging a stuck hub run.
---

# Receipt Hub Loop

Use this skill when the task touches the Receipt hub's self-loop:

- hub objectives and their lifecycle
- Codex execution in hub worktrees
- Git/worktree cleanup or merge behavior
- hub UI columns, detail panes, and human merge flow
- debugging why a hub run blocked, stalled, or produced a bad candidate

## First Read

Read `docs/hub-codex-playbook.md` before making changes. It is the authoritative codebase map for this loop.

## Working Rules

- Git is the source of truth for code.
- Receipt streams are the source of truth for objective state and job history.
- Do not add a parallel code-state model outside Git.
- Do not edit the main checkout for objective work unless the task is explicitly about source-branch merge behavior.
- Builder changes tracked files in a hub worktree and produces a candidate commit.
- Reviewer validates the candidate commit; human merge finishes the loop.
- Keep tracked project files clean at the end of a pass.
- Remove only unwanted hub worktrees, never the current active worktree.

## How To Inspect A Run

Use the existing surfaces before guessing:

- `GET /hub/api/objectives/:id`
- `GET /hub/api/state`
- `git show <candidate-commit>`
- `git worktree list`
- `.receipt/hub/result.json`
- `.receipt/hub/*.stdout.log`
- `.receipt/hub/*.stderr.log`
- `.receipt/hub/*.last-message.md`
- `receipt jobs`
- `receipt trace <run-id-or-stream>`
- `receipt inspect <run-id-or-stream>`

## Usual Edit Targets

- Hub workflow and reactor: `src/services/hub-service.ts`
- Git/worktrees and promotion: `src/adapters/hub-git.ts`
- Codex execution: `src/adapters/codex-executor.ts`
- Hub routes: `src/agents/hub.agent.ts`
- Objective state model: `src/modules/hub-objective.ts`
- Hub UI: `src/views/hub.ts`
- Verification: `tests/smoke/hub.test.ts`

## Verification

Default to:

- `npm run build`
- `npx tsx --test --test-concurrency=1 tests/smoke/hub.test.ts`

Use `npm run test:smoke` when the change could affect shared routing, queue behavior, or agent runtime behavior outside the hub.
