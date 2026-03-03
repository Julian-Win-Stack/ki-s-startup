# Create an Agent with Receipt Runtime

This guide shows the shortest path to build a new agent in this repo using the Receipt framework.

Use this when you want a working agent quickly, with receipts, replay, and time travel by default.

---

## What you build

A complete agent has these parts:

1. `src/modules/<agent-id>.ts`
   - Event types
   - State type
   - `decide`
   - `reduce`
2. `src/agents/<agent-id>.ts`
   - Workflow/lifecycle
   - `run<AgentName>` entrypoint
3. `prompts/<agent-id>.prompts.json`
   - Prompt templates
4. `src/server.ts`
   - Route wiring
5. Optional: `src/views/<agent-id>.ts`
   - UI projection from receipts

---

## 1) Scaffold the files

From repo root:

```bash
npm run new:agent -- my-agent
```

This creates:

- `src/modules/my-agent.ts`
- `src/agents/my-agent.ts`
- `prompts/my-agent.prompts.json`
- `tests/smoke/my-agent.smoke.test.ts`

Agent ids must be kebab-case (`my-agent`, `receipt-auditor`).

---

## 2) Define your receipts in the module

Edit `src/modules/my-agent.ts`:

- Keep events explicit (`problem.set`, `run.status`, domain events, `solution.finalized`).
- Keep reducer pure and deterministic.
- Do not store derived data that can be folded from receipts.

Minimal rule:

- Receipts are the source of truth.
- State is only a fold result.

---

## 3) Implement workflow in the agent file

Edit `src/agents/my-agent.ts`:

- Keep lifecycle events in `init`:
  - `problem.set`
  - `run.configured`
  - `run.status` (`running`)
- In `run`, emit domain events as work completes.
- End with:
  - `solution.finalized`
  - `run.status` (`completed` or `failed`)

If your workflow is planner-driven, emit step receipts (`step.ready`, `step.started`, `step.completed`, `step.failed`) so coordination UI can project lanes and timeline correctly.

---

## 4) Add prompts

Edit `prompts/my-agent.prompts.json` with stable keys.

Keep prompt keys version-friendly. Stable keys make replay and diffing easier across runs.

---

## 5) Wire a route in the server

Update `src/server.ts`:

- Add an endpoint to start a run.
- Build stream names (recommended: index stream + per-run stream).
- Call your `runMyAgent(...)` entrypoint.
- Add read endpoints for run state/view.

Recommended stream layout:

- Index stream: `<base>`
- Run stream: `<base>/runs/<runId>`
- Branch stream: `<base>/runs/<runId>/branches/<branchId>`

---

## 6) Add UI projection (optional but recommended)

Create `src/views/my-agent.ts` or start with JSON output.

For multi-agent coordination UI, use shared framework renderer:

- `src/views/agent-framework.ts` (`frameworkCoordinationHtml`)

Map receipts into:

- Context rows from `prompt.context`
- Lane rows from `agent.status` or planner step receipts
- Trail rows from lifecycle + coordination receipts

---

## 7) Run and verify

```bash
npm run build
npm run test:smoke
npm run dev
```

Open your route and verify:

- Receipts append as work runs
- State is correct at head
- Time travel works for earlier prefixes
- Chain integrity passes

---

## Practical checklist

- Emit `run.configured` once at start.
- Emit `run.status` transitions (`running` -> `completed`/`failed`).
- Keep reducers pure (no I/O, no randomness).
- Keep all external work in workflow code, not reducer.
- Use per-run streams for performance and clean replay.
- Emit memory/context receipts (`prompt.context`, `memory.slice`) when relevant.
- If branching, keep merge decisions explicit as receipts.

---

## Good references in this repo

- Framework overview: `docs/agent-framework.md`
- Theorem reference agent: `src/agents/theorem.ts`
- Writer planner agent: `src/agents/writer.ts`
- Runtime workflow helper: `src/engine/runtime/workflow.ts`
- Receipt runtime surface: `src/engine/runtime/receipt-runtime.ts`
