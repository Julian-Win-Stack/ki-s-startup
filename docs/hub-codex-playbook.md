# Hub Codex Playbook

Use this playbook when working on the Receipt hub objective loop.

## Core Model

- Git is the source of truth for code.
- Receipt streams are the source of truth for objective state and job history.
- Codex works inside hub-managed Git worktrees, not in the main checkout.
- The objective loop is: `planner -> builder -> reviewer -> human merge`.

## Primary Code Paths

- Hub workflow and objective reactor: [src/services/hub-service.ts](/Users/kishore/receipt/src/services/hub-service.ts)
- Git and worktree management: [src/adapters/hub-git.ts](/Users/kishore/receipt/src/adapters/hub-git.ts)
- Codex execution adapter: [src/adapters/codex-executor.ts](/Users/kishore/receipt/src/adapters/codex-executor.ts)
- Hub HTTP/UI routes: [src/agents/hub.agent.ts](/Users/kishore/receipt/src/agents/hub.agent.ts)
- Objective reducer and event model: [src/modules/hub-objective.ts](/Users/kishore/receipt/src/modules/hub-objective.ts)
- Hub metadata reducer: [src/modules/hub.ts](/Users/kishore/receipt/src/modules/hub.ts)
- Hub UI: [src/views/hub.ts](/Users/kishore/receipt/src/views/hub.ts)
- Hub smoke coverage: [tests/smoke/hub.test.ts](/Users/kishore/receipt/tests/smoke/hub.test.ts)

## Git Hygiene

- Do not edit the main checkout directly for objective work.
- Do not invent a parallel code-state model outside Git.
- Keep changes inside the assigned hub worktree unless the task is explicitly about source-branch promotion.
- Builder may change tracked project files. Planner and reviewer should only write under `.receipt/`.
- Leave the worktree clean for tracked project files when a pass finishes.
- Completed objectives are expected to merge cleanly and remove their temporary worktrees.
- If cleaning worktrees manually, never remove the currently active worktree and prefer hub-managed worktrees under `data/hub/worktrees/`.

## How To Inspect What Happened

- Objective detail API: `GET /hub/api/objectives/:id`
- Dashboard state: `GET /hub/api/state`
- Candidate Git diff: `git show <commit>` or `git diff <base> <commit>`
- Worktree list: `git worktree list`
- Hub pass artifacts in each worktree:
  - `.receipt/hub/result.json`
  - `.receipt/hub/*.stdout.log`
  - `.receipt/hub/*.stderr.log`
  - `.receipt/hub/*.last-message.md`
- Receipt CLI for runtime inspection:
  - `receipt jobs`
  - `receipt trace <run-id-or-stream>`
  - `receipt inspect <run-id-or-stream>`
  - `receipt replay <run-id-or-stream>`

## Done Criteria

- The requested code change exists in the candidate branch.
- Required checks passed.
- Reviewer either approved or gave concrete changes requested.
- Human merge fast-forwards the approved candidate into the source branch.
- The objective is not actually done until that merge step succeeds.

## When Working On Codex Integration

- Update prompt templates in [prompts/hub/planner.md](/Users/kishore/receipt/prompts/hub/planner.md), [prompts/hub/builder.md](/Users/kishore/receipt/prompts/hub/builder.md), and [prompts/hub/reviewer.md](/Users/kishore/receipt/prompts/hub/reviewer.md).
- Update the Codex runner in [src/adapters/codex-executor.ts](/Users/kishore/receipt/src/adapters/codex-executor.ts).
- Update objective orchestration in [src/services/hub-service.ts](/Users/kishore/receipt/src/services/hub-service.ts).
- Prefer improving structured handoff, verification, and Git hygiene over adding more orchestration text.
