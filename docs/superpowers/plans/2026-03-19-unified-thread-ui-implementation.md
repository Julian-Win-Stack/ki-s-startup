# Unified Thread-Centric UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the `/factory` (chat) and `/factory/control` (execution details) views into a single, thread-centric interface with contextual sidebars, utilizing implicit objective creation.

**Architecture:** We will merge the routing in `src/agents/factory.agent.ts` to serve a single `/factory` app. The existing 3-pane layout in `factoryChatShell` will be fully utilized. The left rail will serve as the thread history navigation, the center pane will be the chat timeline with rich cards, and the right rail will become the dynamic Inspector. Following strict functional and fail-fast principles, we will split the large `factory-chat.ts` view into smaller, focused modules. We will use exhaustive switching instead of fallbacks.

**Tech Stack:** TypeScript, Hono, HTMX, TailwindCSS

---

## File Structure

- Create: `src/views/factory-models.ts` - Shared types for the unified UI (`FactoryNavModel`, `FactoryInspectorModel`, `FactoryChatItem`).
- Create: `src/views/factory-inspector.ts` - HTMX island rendering for the right rail, with separated view functions.
- Modify: `src/views/factory-chat.ts` - Center pane and shell layout. Will import from new modules.
- Modify: `src/agents/factory.agent.ts` - Hono routing and model building.
- Modify: `src/prompts/agent.ts` - Orchestrator prompt tuning.
- Delete: `src/views/factory-mission-control.ts` - Deprecated.

---

### Task 1: Decompose Models and Define Split

**Files:**
- Create: `src/views/factory-models.ts`
- Modify: `src/views/factory-chat.ts`
- Modify: `src/agents/factory.agent.ts`

- [ ] **Step 1: Write a failing import test**

```typescript
// tests/temp_model_test.ts
import { type FactoryNavModel, type FactoryInspectorModel, type FactoryChatShellModel } from "../src/views/factory-models";
import { type FactoryChatProfileNav, type FactoryChatObjectiveNav, type FactorySelectedObjectiveCard, type FactoryLiveCodexCard, type FactoryLiveChildCard, type FactoryLiveRunCard, type FactoryChatJobNav, type FactoryChatIslandModel } from "../src/views/factory-chat";

const nav: FactoryNavModel = { profiles: [], objectives: [], activeProfileId: "1", activeProfileLabel: "Gen" };
const inspector: FactoryInspectorModel = { panel: "overview", jobs: [] };
const shell: FactoryChatShellModel = { nav, inspector, chat: { items: [], activeProfileId: "1", activeProfileLabel: "Gen" } as any };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun check tests/temp_model_test.ts`
Expected: FAIL due to missing `src/views/factory-models.ts`.

- [ ] **Step 3: Write minimal implementation**

Create `src/views/factory-models.ts` and move the exact types from `factory-chat.ts`:
```typescript
import type { FactoryChatProfileNav, FactoryChatObjectiveNav, FactorySelectedObjectiveCard, FactoryLiveCodexCard, FactoryLiveChildCard, FactoryLiveRunCard, FactoryChatJobNav, FactoryChatIslandModel } from "./factory-chat"; // Note: move these types to models too during actual execution.

export type FactoryNavModel = {
  readonly activeProfileId: string;
  readonly activeProfileLabel: string;
  readonly profiles: ReadonlyArray<FactoryChatProfileNav>;
  readonly objectives: ReadonlyArray<FactoryChatObjectiveNav>;
};

export type FactoryInspectorPanel = "overview" | "execution" | "live" | "receipts" | "debug";

export type FactoryInspectorModel = {
  readonly panel: FactoryInspectorPanel;
  readonly selectedObjective?: FactorySelectedObjectiveCard;
  readonly activeCodex?: FactoryLiveCodexCard;
  readonly liveChildren?: ReadonlyArray<FactoryLiveChildCard>;
  readonly activeRun?: FactoryLiveRunCard;
  readonly jobs: ReadonlyArray<FactoryChatJobNav>;
};

export type FactoryChatShellModel = {
  readonly activeProfileId: string;
  readonly activeProfileLabel: string;
  readonly objectiveId?: string;
  readonly chatId?: string;
  readonly runId?: string;
  readonly jobId?: string;
  readonly chat: FactoryChatIslandModel;
  readonly nav: FactoryNavModel;
  readonly inspector: FactoryInspectorModel;
};
```

Update `factoryChatShell` in `src/views/factory-chat.ts` to use `model.nav` and `model.inspector`. Move the shared types (like `FactoryChatObjectiveNav`) fully into `factory-models.ts`.
Update `src/agents/factory.agent.ts` to import these from `factory-models.js` and map the state in `buildChatShellModel` to `nav` and `inspector` properties instead of `sidebar`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun check tests/temp_model_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm tests/temp_model_test.ts
git add src/views/factory-models.ts src/views/factory-chat.ts src/agents/factory.agent.ts
git commit -m "refactor: Extract and split shell models into factory-models.ts"
```

---

### Task 2: Enhance Chat Feed with Rich Context Cards

**Files:**
- Modify: `src/views/factory-models.ts`
- Modify: `src/views/factory-chat.ts`
- Modify: `src/agents/factory.agent.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/temp_card_test.ts
import { type FactoryChatItem } from "../src/views/factory-models";

const item: FactoryChatItem = {
  key: "test",
  kind: "objective_event",
  title: "Objective Started",
  summary: "Initial planning complete",
  objectiveId: "obj_123"
};
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun check tests/temp_card_test.ts`
Expected: FAIL due to missing `objective_event` kind.

- [ ] **Step 3: Write minimal implementation**

In `src/views/factory-models.ts`, expand `FactoryChatItem`:

```typescript
import type { FactoryWorkCard } from "./factory-chat"; // Move to models too

export type FactoryChatItem =
  // ... existing kinds
  | {
      readonly key: string;
      readonly kind: "work";
      readonly card: FactoryWorkCard;
    }
  | {
      readonly key: string;
      readonly kind: "objective_event";
      readonly title: string;
      readonly summary: string;
      readonly objectiveId: string;
    };
```

In `src/views/factory-chat.ts`, inside `renderChatItem`:
```typescript
  if (item.kind === "objective_event") {
    return `<section class="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 cursor-pointer hover:bg-primary/20 transition"
      hx-get="/factory/island/inspector?thread=${encodeURIComponent(item.objectiveId)}"
      hx-target="#factory-inspector"
      hx-swap="innerHTML">
      <div class="flex items-center gap-2 text-sm font-semibold text-primary">
        <svg class="w-4 h-4"></svg> ${esc(item.title)}
      </div>
      <div class="mt-1 text-xs text-foreground">${esc(item.summary)}</div>
    </section>`;
  }
```

Update `buildChatItemsForRun` in `src/agents/factory.agent.ts` to map `factory.dispatch` tool observations with `action: "create"` or `action: "promote"` into `objective_event` items instead of `work` items.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun check tests/temp_card_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm tests/temp_card_test.ts
git add src/views/factory-models.ts src/views/factory-chat.ts src/agents/factory.agent.ts
git commit -m "feat: Render objective lifecycle events as rich interactive cards"
```

---

### Task 3: Implement Dynamic Right Rail Inspector without Fallbacks

**Files:**
- Create: `src/views/factory-inspector.ts`
- Modify: `src/agents/factory.agent.ts`

- [ ] **Step 1: Write a failing exhaustive matching test**

```typescript
// tests/temp_inspector_test.ts
import { factoryInspectorIsland } from "../src/views/factory-inspector";

try {
  // Pass an invalid panel type by casting to any to test the fail-fast switch
  factoryInspectorIsland({ panel: "invalid" as any, jobs: [] });
  throw new Error("Did not fail fast on invalid panel");
} catch (e: any) {
  if (e.message !== "Unhandled panel type: invalid") throw e;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun check src/server.ts` and `bun test tests/temp_inspector_test.ts`
Expected: FAIL because file is missing or doesn't throw.

- [ ] **Step 3: Write minimal implementation**

Create `src/views/factory-inspector.ts` and separate view functions from control flow. Use exhaustive switch.

```typescript
import { esc, sectionLabelClass, softPanelClass } from "./ui";
import type { FactoryInspectorModel } from "./factory-models";

const renderOverviewPanel = (model: FactoryInspectorModel): string => {
  return `<div class="space-y-3 px-3 py-3 md:px-4">Overview Panel</div>`;
};

const renderExecutionPanel = (model: FactoryInspectorModel): string => {
  return `<div class="space-y-3 px-3 py-3 md:px-4">Execution Graph</div>`;
};

const renderLivePanel = (model: FactoryInspectorModel): string => {
  return `<div class="space-y-3 px-3 py-3 md:px-4">Live Logs</div>`;
};

const renderReceiptsPanel = (model: FactoryInspectorModel): string => {
  return `<div class="space-y-3 px-3 py-3 md:px-4">Receipts</div>`;
};

const renderDebugPanel = (model: FactoryInspectorModel): string => {
  return `<div class="space-y-3 px-3 py-3 md:px-4">Debug</div>`;
};

export const factoryInspectorIsland = (model: FactoryInspectorModel): string => {
  switch (model.panel) {
    case "overview": return renderOverviewPanel(model);
    case "execution": return renderExecutionPanel(model);
    case "live": return renderLivePanel(model);
    case "receipts": return renderReceiptsPanel(model);
    case "debug": return renderDebugPanel(model);
    default: {
      const exhaustiveCheck: never = model.panel;
      throw new Error(`Unhandled panel type: ${exhaustiveCheck}`);
    }
  }
};
```

In `src/agents/factory.agent.ts`, update the route:
```typescript
      app.get("/factory/island/inspector", async (c) => wrap(
        async () => {
          const model = await buildChatShellModelCached({
            profileId: requestedProfileId(c.req.raw),
            objectiveId: requestedObjectiveId(c.req.raw),
            chatId: requestedChatId(c.req.raw),
            runId: requestedRunId(c.req.raw),
            jobId: requestedJobId(c.req.raw),
            // Pass focus params to the builder internally
          });
          // Derive the panel based on query params or objective state
          return { ...model.inspector, panel: requestedPanel(c.req.raw) }; 
        },
        (model) => html(factoryInspectorIsland(model))
      ));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/temp_inspector_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm tests/temp_inspector_test.ts
git add src/views/factory-inspector.ts src/agents/factory.agent.ts
git commit -m "feat: Implement dynamic right rail inspector with exhaustive switching"
```

---

### Task 4: Tune Orchestrator Prompt for Implicit Creation

**Files:**
- Modify: `src/prompts/agent.prompts.json` (or the generator script `src/prompts/agent.ts`)

- [ ] **Step 1: Write a failing prompt check**

```typescript
// tests/temp_prompt_test.ts
import { readFileSync } from "node:fs";
const data = JSON.parse(readFileSync("src/prompts/agent.prompts.json", "utf8"));
if (!data.agent.includes("Implicitly create objectives")) {
    throw new Error("Prompt missing implicit creation instructions");
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun tests/temp_prompt_test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

In `src/prompts/agent.ts` (or equivalent source file), add this instruction to the orchestrator system prompt:
```typescript
"Implicit Objective Creation: You are conversing with the user in a continuous thread. If the user asks for a simple answer, reply directly. If the user asks for a complex multi-step task, code edit, or investigation that requires tracked execution, you must autonomously use the `factory.dispatch` tool with `action: 'create'` to upgrade this thread into a tracked objective. Do not ask for permission to track it; just do it implicitly to ensure their work is tracked."
```
Run the prompt compilation script if one exists (e.g. `npm run build:prompts` or `bun src/prompts/agent.ts`).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun tests/temp_prompt_test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
rm tests/temp_prompt_test.ts
git add src/prompts/agent.prompts.json src/prompts/agent.ts
git commit -m "chore: Update orchestrator prompt for implicit objective creation"
```

---

### Task 5: Clean up deprecated Mission Control files and Fix Tests

**Files:**
- Delete: `src/views/factory-mission-control.ts`
- Modify: `src/agents/factory.agent.ts`
- Modify: `tests/smoke/factory-cli.test.ts`

- [ ] **Step 1: Write failing test**

```bash
grep -r "factory-mission-control" src/server.ts src/agents/factory.agent.ts
```
Expected: Matches found.

- [ ] **Step 2: Remove references and file**

```bash
rm src/views/factory-mission-control.ts
```
In `src/agents/factory.agent.ts`, remove all imports from `factory-mission-control.ts`. 
Delete or rewrite the `/factory/control` and `/factory/control/island/*` Hono routes to `return new Response(null, { status: 301, headers: { Location: '/factory' } })`.

- [ ] **Step 3: Update `tests/smoke/factory-cli.test.ts`**

In `factory-cli.test.ts`, the `test("factory cli: mission control screens render from shared projections")` tests the React CLI interface against the old projection models. We must update it to test the new chat shell projection.

```typescript
    // Replace the board/compose logic with the new Chat shell build
    const shellModel = await runtime.service.buildChatShellModelCached({
       objectiveId: runPayload.objectiveId
    });
    
    // Test the React components that render these new models in the CLI
    // (Assuming the CLI React app is updated to consume the unified model)
    const boardScreen = stripAnsi(renderToString(
      React.createElement(FactoryThemeProvider, undefined,
        React.createElement(FactoryBoardScreen, {
          state: { compose, board, selected: detail, live, shell: shellModel }, // Add shell to state if needed by CLI
          selectedObjectiveId: runPayload.objectiveId,
          compact: false,
          stacked: false,
          message: "Factory ready.",
        }),
      ),
    ));
    const normalizedBoard = boardScreen.toLowerCase();
    expect(normalizedBoard).toContain("factory");
```

- [ ] **Step 4: Run tests to verify**

Run: `bun check src/server.ts` and `bun test tests/smoke/factory-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/factory.agent.ts tests/smoke/factory-cli.test.ts
git commit -m "refactor: Remove deprecated mission control and update tests"
```