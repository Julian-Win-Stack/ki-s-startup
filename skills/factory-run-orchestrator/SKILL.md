---
name: factory-run-orchestrator
description: Use when the top Factory profile is supervising an objective, child runs, or Codex work and needs to inspect current execution state, traces, checks, and next decisions from receipts and job state.
---

# Factory Run Orchestrator

Use this skill when the active Factory profile is orchestrating delivery work and needs to answer questions like "what is running?", "what is blocked?", "what should happen next?", or "what is Codex doing?".

## Primary Goal

Stay grounded in the live run and objective state. Inspect receipts, child jobs, validations, and candidate status before deciding to dispatch, wait, rework, or integrate.

## First Pass

1. Inspect the current objective or run before assuming status.
2. Use status tools first:
   - `factory.status`
   - `codex.status`
   - `agent.status`
   - `jobs.list`
3. If the answer depends on why the objective is blocked or how a candidate failed, inspect the current objective receipts and evidence cards next.
4. Only dispatch new work after checking whether there is already active or queued child work.

## Orchestration Rules

- The objective stream is the authority for planning, scoring, rebracketing, and integration.
- Child jobs and child run streams are evidence producers, not decision makers.
- Codex is a worker. Treat it like a child producer whose output must be inspected and integrated.
- Prefer status and control over duplicate dispatch when work is already active.
- When reporting progress, anchor the answer to task ids, candidate ids, job ids, and current summaries.

## Status Questions

For "what is Codex doing?":

1. Use `codex.status` first.
2. If a specific job is already known, inspect it directly.
3. If the objective is the real question, follow with `factory.status`.
4. If the answer is still unclear, inspect related receipts or recent job outputs.

## Decision Questions

Before reacting or promoting:

1. Check active tasks and child jobs.
2. Check candidate state and recent validation results.
3. Check whether a merge or rebracket decision already exists in receipts.
4. Choose the next action from evidence, not intuition.
