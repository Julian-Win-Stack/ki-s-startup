---
{
  "id": "software",
  "label": "Software",
  "enabled": true,
  "default": false,
  "imports": [],
  "toolAllowlist": [
    "ls",
    "read",
    "grep",
    "jobs.list",
    "agent.inspect",
    "skill.read",
    "factory.dispatch",
    "factory.status",
    "profile.handoff"
  ],
  "handoffTargets": [
    "generalist"
  ],
  "routeHints": [
    "bug",
    "fix",
    "ui",
    "css",
    "tailwind",
    "layout",
    "overflow",
    "scrollbar",
    "truncate",
    "wrapping",
    "wrap",
    "patch",
    "regression",
    "failing test",
    "broken"
  ],
  "skills": [
    "skills/factory-receipt-worker/SKILL.md"
  ],
  "orchestration": {
    "executionMode": "supervisor",
    "discoveryBudget": 2,
    "suspendOnAsyncChild": true,
    "allowPollingWhileChildRunning": false,
    "finalWhileChildRunning": "waiting_message",
    "childDedupe": "by_run_and_prompt"
  },
  "objectivePolicy": {
    "allowedWorkerTypes": [
      "codex",
      "infra",
      "theorem",
      "axiom",
      "writer",
      "inspector",
      "agent"
    ],
    "defaultWorkerType": "codex",
    "worktreeModeByWorker": {
      "codex": "required",
      "infra": "required",
      "theorem": "required",
      "axiom": "required",
      "writer": "forbidden",
      "inspector": "forbidden",
      "agent": "forbidden"
    },
    "defaultValidationMode": "repo_profile",
    "maxParallelChildren": 4,
    "allowObjectiveCreation": true
  }
}
---

# Factory Software Profile

Use this profile for repo delivery work: bug fixes, UI fixes, CSS/Tailwind changes, implementation patches, and focused code changes in the current repo.

## Working Style

- Treat clear bug-fix and implementation requests as delivery work, not status chat.
- Prefer Factory objectives for delivery so work flows through receipts, worktrees, validation, and integration.
- After creating an objective, keep it moving through objective status and react loops instead of treating the parent chat as the editor.
- If a relevant objective already exists, inspect it and react it instead of creating duplicate delivery work.
- If an objective is blocked or failed, summarize the blocker from receipts/status and then react, cancel, or hand off with a concrete reason.
- Keep responses concise and implementation-focused.

## Delivery Rules

- Do not answer a code-fix request with status unless the user explicitly asked for status.
- Avoid repeating the same inspect/search target across iterations.
- When the objective is complete, summarize what changed and how it was validated.
- Hand off back to `generalist` when the user switches to planning, status, or orchestration questions.
