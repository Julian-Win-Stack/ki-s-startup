# HTTP API Reference

Base URL: `http://localhost:8787` (or `PORT`).

## Conventions
- JSON APIs use `Content-Type: application/json`.
- Form routes use `Content-Type: application/x-www-form-urlencoded`.
- HTML routes return `text/html; charset=utf-8`.
- Error payloads are plain text unless explicitly documented as JSON.
- Most mutating routes publish SSE refresh events (`receipt`, `jobs`, `agent`).

## Core Server APIs

### POST /agents/:id/jobs
- Purpose: Enqueue a job for any registered agent (`agent`, `factory`, `codex`).
- Query params: none.
- Body schema (JSON):
```json
{
  "jobId": "optional-id",
  "lane": "collect|steer|follow_up",
  "maxAttempts": 2,
  "sessionKey": "optional",
  "singletonMode": "allow|cancel|steer",
  "singleton": { "key": "optional", "mode": "allow|cancel|steer" },
  "payload": { "kind": "agent.run", "stream": "agents/agent", "runId": "run_...", "problem": "...", "config": {} }
}
```
- Success: `202` with `{ ok: true, job }`.
- Errors: `400` malformed JSON.
- Side effects: appends `job.enqueued` and publishes `job-refresh` + `receipt-refresh`.
- Example:
```bash
curl -sS -X POST http://localhost:8787/agents/agent/jobs \
  -H 'content-type: application/json' \
  -d '{"payload":{"kind":"agent.run","stream":"agents/agent","runId":"run_demo","problem":"Review open issues","config":{"maxIterations":3}}}'
```

### GET /jobs
- Purpose: List recent jobs from queue index projection.
- Query params: `status` (`queued|leased|running|completed|failed|canceled`), `limit` (`1..500`, default `50`).
- Body: none.
- Success: `200` with `{ jobs: QueueJob[] }`.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS 'http://localhost:8787/jobs?status=running&limit=25'
```

### GET /jobs/:id
- Purpose: Fetch a single job snapshot.
- Query params: none.
- Body: none.
- Success: `200` with `QueueJob`.
- Errors: `404` when job is missing.
- Side effects: none.
- Example:
```bash
curl -sS http://localhost:8787/jobs/job_abc123
```

### GET /jobs/:id/wait
- Purpose: Long-poll until job reaches terminal state or timeout.
- Query params: `timeoutMs` (`0..120000`, default `15000`).
- Body: none.
- Success: `200` with terminal (or latest) `QueueJob`.
- Errors: `404` when job is missing.
- Side effects: none.
- Example:
```bash
curl -sS 'http://localhost:8787/jobs/job_abc123/wait?timeoutMs=30000'
```

### GET /jobs/:id/events
- Purpose: SSE stream scoped to one job id.
- Query params: none.
- Body: none.
- Success: `200` SSE stream.
- Errors: none expected.
- Side effects: keeps an open subscription.
- Example:
```bash
curl -N http://localhost:8787/jobs/job_abc123/events
```

### POST /jobs/:id/steer
- Purpose: Queue a `steer` command for a job.
- Query params: none.
- Body schema (JSON): `{ "payload": { ... }, "by": "optional" }`.
- Success: `202` with `{ ok: true, command }`.
- Errors: `404` job not found.
- Side effects: appends `queue.command`, publishes jobs + receipt refresh.
- Example:
```bash
curl -sS -X POST http://localhost:8787/jobs/job_abc123/steer \
  -H 'content-type: application/json' \
  -d '{"payload":{"problem":"Retarget objective"},"by":"api"}'
```

### POST /jobs/:id/follow-up
- Purpose: Queue a `follow_up` command for a job.
- Query params: none.
- Body schema (JSON): `{ "payload": { "note": "..." }, "by": "optional" }`.
- Success: `202` with `{ ok: true, command }`.
- Errors: `404` job not found.
- Side effects: appends `queue.command`, publishes jobs + receipt refresh.
- Example:
```bash
curl -sS -X POST http://localhost:8787/jobs/job_abc123/follow-up \
  -H 'content-type: application/json' \
  -d '{"payload":{"note":"Please continue with migration plan"}}'
```

### POST /jobs/:id/abort
- Purpose: Request cancel of a queued/running job.
- Query params: none.
- Body schema (JSON): `{ "reason": "optional", "by": "optional" }`.
- Success: `202` with `{ ok: true, command }`.
- Errors: `404` job not found.
- Side effects: appends `queue.command` (and immediate cancel for queued jobs), publishes jobs + receipt refresh.
- Example:
```bash
curl -sS -X POST http://localhost:8787/jobs/job_abc123/abort \
  -H 'content-type: application/json' \
  -d '{"reason":"user requested stop"}'
```

## Factory Web Surface

Factory operator mutations are CLI-first. The `/factory` pages remain available for read-only inspection, live output, and receipts/debug views, but the old mutating `/factory` POST routes have been removed.

Use the CLI for mutations:

- `receipt factory run|create|compose|react|promote|cancel|cleanup|archive`
- `receipt factory steer|follow-up|abort-job`

Read-only Factory HTTP routes that remain supported:

- `GET /factory`
- `GET /factory/control`
- `GET /factory/island/*`
- `GET /factory/events`
- `GET /factory/control/events`
- `GET /factory/api/objectives`
- `GET /factory/api/objectives/:id`
- `GET /factory/api/objectives/:id/debug`
- `GET /factory/api/objectives/:id/receipts`
- `GET /factory/api/live-output`

### POST /memory/:scope/read
- Purpose: Read recent memory entries for a scope.
- Query params: none.
- Body schema (JSON): `{ "limit": 20 }` (optional).
- Success: `200` with `{ entries }`.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS -X POST http://localhost:8787/memory/release/read \
  -H 'content-type: application/json' \
  -d '{"limit":10}'
```

### POST /memory/:scope/search
- Purpose: Search memory by semantic/keyword query.
- Query params: none.
- Body schema (JSON): `{ "query": "...", "limit": 20 }`.
- Success: `200` with `{ entries }`.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS -X POST http://localhost:8787/memory/release/search \
  -H 'content-type: application/json' \
  -d '{"query":"queue behavior","limit":5}'
```

### POST /memory/:scope/summarize
- Purpose: Summarize scoped memory entries.
- Query params: none.
- Body schema (JSON): `{ "query": "optional", "limit": 20, "maxChars": 2400 }`.
- Success: `200` with `{ summary, entries }`.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS -X POST http://localhost:8787/memory/release/summarize \
  -H 'content-type: application/json' \
  -d '{"query":"inspector","maxChars":1200}'
```

### POST /memory/:scope/commit
- Purpose: Persist a new memory entry.
- Query params: none.
- Body schema (JSON): `{ "text": "...", "tags": ["a"], "meta": { "k": "v" } }`.
- Success: `201` with `{ entry }`.
- Errors: `400` when `text` is empty.
- Side effects: appends memory receipt and publishes `receipt-refresh`.
- Example:
```bash
curl -sS -X POST http://localhost:8787/memory/release/commit \
  -H 'content-type: application/json' \
  -d '{"text":"Need stricter review gate","tags":["ops"]}'
```

### POST /memory/:scope/diff
- Purpose: Read memory entries in a timestamp window.
- Query params: none.
- Body schema (JSON): `{ "fromTs": 1700000000000, "toTs": 1700000100000 }`.
- Success: `200` with `{ entries }`.
- Errors: `400` when `fromTs` missing/invalid.
- Side effects: none.
- Example:
```bash
curl -sS -X POST http://localhost:8787/memory/release/diff \
  -H 'content-type: application/json' \
  -d '{"fromTs":1700000000000}'
```

## Monitor Routes

### GET /monitor
- Purpose: Command Center shell page.
- Query params: `stream` (default `agents/agent`), `run`, `job`.
- Body: none.
- Success: `200` HTML.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS 'http://localhost:8787/monitor?stream=agents/agent'
```

### POST /monitor/run
- Purpose: Enqueue a monitor/agent run from UI form.
- Query params: `stream` (default `agents/agent`).
- Body schema (form): `problem` (required), optional agent config fields (`maxIterations`, `maxToolOutputChars`, `memoryScope`, `workspace`).
- Success: `303` redirect response with `HX-Redirect`.
- Errors: `400 problem required`.
- Side effects: enqueues `agent.run` job and publishes `jobs`, `agent`, `receipt` refresh events.
- Example:
```bash
curl -i -X POST 'http://localhost:8787/monitor/run?stream=agents/agent' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -d 'problem=Review+open+issues&maxIterations=3'
```

### POST /monitor/job/:id/steer
- Purpose: Queue steer command for selected monitor job.
- Query params: `stream`, `run`, `job`.
- Body schema (form): `problem` and/or `config` (JSON object string).
- Success: `202` plain text when `X-Requested-With: fetch`, otherwise `303` redirect.
- Errors: `400` invalid payload/config, `404` job missing.
- Side effects: queues `steer` command and publishes `jobs`, `agent`, `receipt`.
- Example:
```bash
curl -sS -X POST 'http://localhost:8787/monitor/job/job_abc/steer?stream=agents/agent' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -H 'X-Requested-With: fetch' \
  -d 'problem=Narrow+scope'
```

### POST /monitor/job/:id/follow-up
- Purpose: Queue follow-up note command.
- Query params: `stream`, `run`, `job`.
- Body schema (form): `note` (required).
- Success: `202` plain text when fetch-mode, otherwise redirect.
- Errors: `400 note required`, `404 job not found`.
- Side effects: queues `follow_up` command and publishes `jobs`, `agent`, `receipt`.
- Example:
```bash
curl -sS -X POST 'http://localhost:8787/monitor/job/job_abc/follow-up?stream=agents/agent' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -H 'X-Requested-With: fetch' \
  -d 'note=Add+acceptance+criteria'
```

### POST /monitor/job/:id/abort
- Purpose: Queue abort command for monitor job.
- Query params: `stream`, `run`, `job`.
- Body schema (form): `reason` (optional).
- Success: `202` plain text when fetch-mode, otherwise redirect.
- Errors: `404 job not found`.
- Side effects: queues `abort` command and publishes `jobs`, `agent`, `receipt`.
- Example:
```bash
curl -sS -X POST 'http://localhost:8787/monitor/job/job_abc/abort?stream=agents/agent' \
  -H 'content-type: application/x-www-form-urlencoded' \
  -H 'X-Requested-With: fetch' \
  -d 'reason=user+cancel'
```

### GET /monitor/island/log
- Purpose: Monitor run log island for selected run.
- Query params: `stream`, `run`.
- Body: none.
- Success: `200` HTML.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS 'http://localhost:8787/monitor/island/log?stream=agents/agent&run=run_demo'
```

### GET /monitor/island/jobs
- Purpose: Monitor job table island.
- Query params: `job` (selected id).
- Body: none.
- Success: `200` HTML.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS 'http://localhost:8787/monitor/island/jobs?job=job_abc'
```

### GET /monitor/island/job
- Purpose: Monitor job detail island.
- Query params: `stream`, `run`, `job`.
- Body: none.
- Success: `200` HTML.
- Errors: none expected (`not found` rendered in HTML).
- Side effects: none.
- Example:
```bash
curl -sS 'http://localhost:8787/monitor/island/job?stream=agents/agent&job=job_abc'
```

### GET /monitor/island/agents
- Purpose: Monitor agent health/activity island.
- Query params: none.
- Body: none.
- Success: `200` HTML.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS 'http://localhost:8787/monitor/island/agents'
```

### GET /monitor/island/activity
- Purpose: Monitor global activity feed island.
- Query params: `stream` (optional filter).
- Body: none.
- Success: `200` HTML.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS 'http://localhost:8787/monitor/island/activity?stream=agents/agent'
```

### GET /monitor/island/memory
- Purpose: Monitor memory search island.
- Query params: `scope` (default `agent`), `query` (optional).
- Body: none.
- Success: `200` HTML.
- Errors: none expected.
- Side effects: none.
- Example:
```bash
curl -sS 'http://localhost:8787/monitor/island/memory?scope=agent&query=delegate'
```

### GET /monitor/stream
- Purpose: SSE subscription for monitor/agent topic.
- Query params: `stream` (default `agents/agent`).
- Body: none.
- Success: `200` SSE stream.
- Errors: none expected.
- Side effects: open stream.
- Example:
```bash
curl -N 'http://localhost:8787/monitor/stream?stream=agents/agent'
```
