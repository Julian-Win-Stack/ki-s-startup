# Unified Thread-Centric UI Design

## Problem Statement
Currently, Receipt's UI suffers from a fragmented conceptual model. Profiles, Objectives, Runs, Jobs, and Threads exist as separate views or loosely coupled concepts (e.g., `/factory` for chat vs. `/factory/control` for deep execution state). This leads to confusion: asking a question might spawn multiple detached projects, it's hard to track the lineage of work, and the role of "Profiles" feels disconnected from the actual orchestration. The "left column / right column" layout in the control view is dense and detached from the conversation that initiated the work.

## Core Architectural Shift: The Thread as the Source of Truth
We are moving to a **Thread-Centric** model. The linear chat feed becomes the primary interface and the chronological source of truth. The arbitrary split between "chat" and "control/execution" is removed.

### Layout Structure: Single View with Contextual Sidebars
The UI will adopt a 3-pane layout, but governed entirely by the active thread:

1. **Left Rail (Navigation & History):**
   - Chronological list of past threads (conversations).
   - Global navigation (Settings, etc.).

2. **Center Pane (The Thread Feed):**
   - The primary interaction surface.
   - Contains standard chat bubbles (User vs. AI Profile).
   - **Crucially:** System state changes, Job executions, and Objective lifecycles are injected directly into this timeline as **rich, interactive inline cards**. For example, when Codex starts a job, a "Codex Job Running" card appears in the chat stream. 

3. **Right Rail (The Dynamic Inspector):**
   - This pane replaces the disconnected `/factory/control` view.
   - It is entirely context-dependent based on what is selected in the Center Pane.
   - **Default:** Shows high-level thread metadata (selected Profile, token usage, etc.).
   - **Focusing an Objective:** Clicking an Objective card in the chat populates the Right Rail with the task tree, integration status, and policy controls for that specific objective.
   - **Focusing a Job:** Clicking a Job card in the chat switches the Right Rail to stream the live `stdout`/`stderr` logs from the worktree for that job.

### The Objective Lifecycle: Implicit Creation
To solve the "is this tracked?" confusion, we are adopting an **Implicit Creation** model for Objectives.

1. **Starting:** Every interaction begins simply as a chat thread with a selected Profile.
2. **Upgrading:** The Orchestrator AI evaluates the user's request. If the request requires multi-step planning, code editing, or delegation, the Orchestrator autonomously decides to "upgrade" the thread.
3. **Execution:** The Orchestrator emits an `objective.created` receipt. In the UI, a system card appears in the timeline stating "Upgraded to tracked project". The Right Rail automatically pivots to display the new Objective's decomposition and progress.

### Profile Organization: Profiles as Personas
Profiles will act as "Personas" that govern a specific thread, rather than structural workspaces.

- When creating a new thread, the user selects a Profile via a top-level dropdown or selector (e.g., "Generalist", "Frontend Expert").
- The chosen Profile dictates the system prompt, available tools, and allowed worker types for that specific thread.
- In the Left Rail history, threads are mixed chronologically, but feature visual indicators (icons/badges) showing which Profile handled them.

## Implementation Implications
1. **Merge `/factory` and `/factory/control`:** The routing and projection logic must be unified so that the chat state and the execution state (formerly in the `mission-control` views) can be queried and rendered together.
2. **Interactive Chat Items:** The `FactoryChatItem` union in `src/views/factory-chat.ts` will need to be expanded to handle rich Objective and Job states natively, not just generic "work" or "system" messages.
3. **Right Rail Routing:** The Inspector pane needs robust HTMX targeting to swap between "Objective Details" (task graphs) and "Job Details" (live logs) without reloading the chat feed.
4. **Orchestrator Prompting:** The `orchestrator` agent's prompt must be tuned to reliably make the "Implicit Creation" decision—knowing when to answer directly vs. when to emit an `objective.created` event.