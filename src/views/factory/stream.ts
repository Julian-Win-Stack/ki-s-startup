import type {
  FactoryComposeModel,
  FactoryLiveProjection,
  FactoryObjectiveDetail,
  StreamAction,
  StreamEntry,
  StreamEntryKind,
} from "./types.js";
import {
  btnDanger,
  btnGhost,
  btnPrimary,
  cardInner,
  emptyText,
  esc,
  flexBetween,
  formInput,
  formatDuration,
  kicker,
  labelUpper,
  modalCard,
  mutedSm,
  renderPill,
  renderStreamEntry,
  shortHash,
  statLabel,
  titleSm,
} from "./widgets.js";

// ── Stream entry builders ────────────────────────────────────────────────────

const actionsForEntry = (
  entry: {
    readonly kind: string;
    readonly taskId?: string;
    readonly candidateId?: string;
  },
  objectiveId: string,
  integrationStatus?: string,
): ReadonlyArray<StreamAction> => {
  const base = `/factory/ui/objectives/${encodeURIComponent(objectiveId)}`;
  const actions: StreamAction[] = [];
  if (entry.kind === "blocked") {
    actions.push({ label: "React", endpoint: `${base}/react`, variant: "ghost" });
  }
  if (entry.kind === "promotion" && integrationStatus === "ready_to_promote") {
    actions.push({ label: "Promote", endpoint: `${base}/promote`, variant: "primary" });
  }
  return actions;
};

const severityForKind = (kind: StreamEntryKind, status?: string): StreamEntry["severity"] => {
  if (kind === "blocked" || kind === "task_failed") return "error";
  if (kind === "task_completed" || kind === "promotion") return "success";
  if (kind === "live") return "accent";
  if (kind === "decision" && status === "blocked") return "warning";
  return "normal";
};

export const mergeStreamEntries = (
  detail: FactoryObjectiveDetail,
  live?: FactoryLiveProjection,
): ReadonlyArray<StreamEntry> => {
  const objectiveId = detail.objectiveId;
  const integrationStatus = detail.integration?.status;
  const entries: StreamEntry[] = [];

  for (const ev of detail.evidenceCards) {
    const kind: StreamEntryKind = ev.kind === "blocked" ? "blocked"
      : ev.kind === "promotion" ? "promotion"
      : ev.kind === "plan" ? "plan_adopted"
      : ev.kind === "merge" ? "merge"
      : "decision";
    entries.push({
      kind,
      title: ev.title,
      summary: ev.summary,
      at: ev.at,
      taskId: ev.taskId,
      candidateId: ev.candidateId,
      receiptHash: ev.receiptHash,
      actions: actionsForEntry({ kind, taskId: ev.taskId, candidateId: ev.candidateId }, objectiveId, integrationStatus),
      severity: severityForKind(kind, detail.status),
    });
  }

  for (const act of detail.activity) {
    const kind: StreamEntryKind = act.kind === "task"
      ? (act.summary.toLowerCase().includes("complete") ? "task_completed"
        : act.summary.toLowerCase().includes("fail") ? "task_failed"
        : "task_dispatched")
      : act.kind === "job" ? "job"
      : "receipt";
    entries.push({
      kind,
      title: act.title,
      summary: act.summary,
      at: act.at,
      taskId: act.taskId,
      candidateId: act.candidateId,
      actions: [],
      severity: severityForKind(kind),
    });
  }

  entries.sort((a, b) => a.at - b.at);

  if (live?.activeTasks.length) {
    for (const task of live.activeTasks) {
      const lines = [task.lastMessage, task.stdoutTail, task.stderrTail]
        .filter(Boolean)
        .join("\n")
        .slice(-200);
      entries.push({
        kind: "live",
        title: `${task.taskId}: ${task.title}`,
        summary: lines || `${task.workerType} · ${formatDuration(task.elapsedMs)}`,
        at: Date.now(),
        taskId: task.taskId,
        actions: [],
        severity: "accent",
      });
    }
  }

  return entries;
};

// ── Compose modal ────────────────────────────────────────────────────────────

export const factoryComposeIsland = (model: FactoryComposeModel): string => `
  <section id="factory-compose" class="compose-overlay" aria-hidden="true">
    <div class="${modalCard} w-[min(860px,calc(100vw-48px))] p-6 grid gap-5">
      <div class="${flexBetween}">
        <div>
          <div class="${kicker}">New Objective</div>
          <h2 class="m-0 text-2xl font-semibold leading-tight mt-1">Launch a Factory objective</h2>
          <p class="m-0 text-muted-foreground text-sm leading-relaxed mt-1">Factory turns a repo objective into a task graph, worker passes, integration, validation, and promotion.</p>
        </div>
        <button type="button" class="${btnGhost}" data-compose-close>Close</button>
      </div>
      <form
        class="grid gap-3"
        action="/factory/ui/objectives"
        method="post"
        hx-post="/factory/ui/objectives"
        hx-swap="none"
        hx-on::after-request="if (event.detail.successful) this.reset()">
        <label class="grid gap-1.5">
          <span class="${labelUpper}">Objective</span>
          <textarea name="prompt" class="${formInput} min-h-[160px] resize-y" placeholder="Describe the change, acceptance criteria, and repository constraints." required></textarea>
        </label>
        <div class="grid grid-cols-2 gap-3">
          <label class="grid gap-1.5">
            <span class="${labelUpper}">Optional title</span>
            <input name="title" class="${formInput}" placeholder="Factory derives one from the objective if you leave this blank." />
          </label>
          <label class="grid gap-1.5">
            <span class="${labelUpper}">Channel</span>
            <input name="channel" class="${formInput}" placeholder="results" value="results" />
          </label>
        </div>
        <details class="${cardInner}">
          <summary class="cursor-pointer list-none font-medium text-sm">Advanced</summary>
          <div class="grid grid-cols-2 gap-3 mt-3">
            <label class="grid gap-1.5">
              <span class="${labelUpper}">Base commit</span>
              <input name="baseHash" class="${formInput}" placeholder="optional base commit" />
            </label>
            <label class="grid gap-1.5">
              <span class="${labelUpper}">Validation Commands</span>
              <textarea name="validationCommands" class="${formInput} min-h-[100px] resize-y" placeholder="One command per line.">${esc(model.defaultValidationCommands.join("\n"))}</textarea>
            </label>
            <label class="grid gap-1.5">
              <span class="${labelUpper}">Policy override</span>
              <textarea name="policy" class="${formInput} min-h-[100px] resize-y" placeholder='Optional JSON policy override, e.g. {"promotion":{"autoPromote":false}}'></textarea>
            </label>
          </div>
        </details>
        <div class="flex justify-between items-center gap-3 flex-wrap">
          <div class="flex items-center gap-2 flex-wrap">
            ${renderPill(`${model.objectiveCount} objectives`, "count")}
            ${renderPill(model.sourceBranch ?? model.defaultBranch, "branch")}
            ${renderPill(model.repoProfile.status.replaceAll("_", " "), model.repoProfile.status)}
          </div>
          <button type="submit" class="${btnPrimary}">Launch Objective</button>
        </div>
        ${model.sourceDirty
          ? `<div class="rounded-md text-sm p-3 bg-warning/10 text-warning border border-warning/20">Objective creation is blocked while the source repo has uncommitted changes unless you provide a base commit.</div>`
          : model.repoProfile.summary
            ? `<div class="rounded-md text-sm p-3 bg-muted/50 text-muted-foreground">${esc(model.repoProfile.summary)}</div>`
            : ""}
      </form>
    </div>
  </section>
`;

// ── Stream island (selected objective) ───────────────────────────────────────

const renderStreamHeader = (detail: FactoryObjectiveDetail): string => {
  const phase = detail.phase ?? "executing";
  const slotState = detail.scheduler?.slotState ?? "active";
  const integrationStatus = detail.integration?.status ?? detail.integrationStatus ?? "idle";
  const base = `/factory/ui/objectives/${encodeURIComponent(detail.objectiveId)}`;
  return `
    <header class="grid gap-3 pb-4 border-b border-primary/12">
      <div class="${flexBetween} gap-4">
        <div>
          <div class="flex gap-1.5 flex-wrap">
            ${renderPill(phase.replaceAll("_", " "), phase)}
            ${renderPill(slotState, slotState)}
            ${renderPill(integrationStatus.replaceAll("_", " "), integrationStatus)}
          </div>
          <h2 class="m-0 text-xl font-semibold leading-tight mt-2">${esc(detail.title)}</h2>
          <p class="m-0 text-muted-foreground text-xs mt-1 font-mono">${esc(detail.objectiveId)}</p>
        </div>
        <div class="flex flex-wrap gap-2 justify-end shrink-0">
          <form action="${base}/react" method="post" hx-post="${base}/react" hx-swap="none"><button type="submit" class="${btnGhost} text-xs">React</button></form>
          ${integrationStatus === "ready_to_promote"
            ? `<form action="${base}/promote" method="post" hx-post="${base}/promote" hx-swap="none"><button type="submit" class="${btnPrimary} text-xs">Promote</button></form>`
            : ""}
          <form action="${base}/cleanup" method="post" hx-post="${base}/cleanup" hx-swap="none"><button type="submit" class="${btnGhost} text-xs">Cleanup</button></form>
          <form action="${base}/archive" method="post" hx-post="${base}/archive" hx-swap="none"><button type="submit" class="${btnGhost} text-xs">Archive</button></form>
          <form action="${base}/cancel" method="post" hx-post="${base}/cancel" hx-swap="none"><button type="submit" class="${btnDanger} text-xs">Cancel</button></form>
        </div>
      </div>
      <p class="m-0 text-muted-foreground text-sm">${esc(detail.nextAction ?? "Factory is replaying receipts and waiting for the next control transition.")}</p>
      <div class="flex flex-wrap gap-4 text-xs">
        <span class="${statLabel}">Runs</span><span class="font-mono">${detail.budgetState.taskRunsUsed}/${detail.policy.budgets.maxTaskRuns}</span>
        <span class="${statLabel}">Elapsed</span><span class="font-mono">${detail.budgetState.elapsedMinutes}m</span>
        <span class="${statLabel}">Tasks</span><span class="font-mono">${detail.tasks.length}</span>
        <span class="${statLabel}">Commit</span><span class="font-mono">${esc(shortHash(detail.latestCommitHash))}</span>
      </div>
    </header>
  `;
};

const renderBlockedAlert = (detail: FactoryObjectiveDetail): string =>
  detail.blockedExplanation
    ? `
      <div class="animate-[pulse-border_2s_ease-in-out_infinite] grid gap-1 p-3 rounded-md border border-destructive/25 bg-destructive/8 text-sm">
        <strong class="text-destructive">Blocked</strong>
        <span class="text-destructive/80">${esc(detail.blockedExplanation.summary)}</span>
        <div class="mt-1">
          <form action="/factory/ui/objectives/${encodeURIComponent(detail.objectiveId)}/react" method="post"
                hx-post="/factory/ui/objectives/${encodeURIComponent(detail.objectiveId)}/react" hx-swap="none">
            <button type="submit" class="${btnGhost} text-xs">React to re-evaluate</button>
          </form>
        </div>
      </div>
    `
    : "";

const renderLiveSection = (live: FactoryLiveProjection | undefined): string => {
  if (!live?.activeTasks.length) return "";
  return `
    <div class="stream-live-divider flex items-center gap-3 py-2">
      <div class="h-px flex-1 bg-ring/30"></div>
      <span class="text-[10px] uppercase tracking-widest text-ring font-medium">live</span>
      <div class="h-px flex-1 bg-ring/30"></div>
    </div>
    <div class="grid gap-2">
      ${live.activeTasks.map((task) => `
        <article class="${cardInner}">
          <div class="${flexBetween}">
            <div>
              <strong class="font-mono text-xs">${esc(task.taskId)}</strong>
              <span class="${mutedSm} ml-2">${esc(task.workerType)} · ${esc(formatDuration(task.elapsedMs))}</span>
            </div>
            ${renderPill((task.jobStatus ?? task.status).replaceAll("_", " "), task.jobStatus ?? task.status)}
          </div>
          <div class="${titleSm} mt-1">${esc(task.title)}</div>
          ${task.lastMessage ? `<pre class="mt-2 whitespace-pre-wrap text-[11px] text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto">${esc(task.lastMessage)}</pre>` : ""}
          ${task.stdoutTail ? `<pre class="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground overflow-x-auto max-h-32 overflow-y-auto">${esc(task.stdoutTail)}</pre>` : ""}
          ${task.stderrTail ? `<pre class="mt-1 whitespace-pre-wrap text-[11px] text-destructive overflow-x-auto max-h-32 overflow-y-auto">${esc(task.stderrTail)}</pre>` : ""}
        </article>
      `).join("")}
    </div>
  `;
};

export const factoryStreamIsland = (
  detail: FactoryObjectiveDetail | undefined,
  live: FactoryLiveProjection | undefined,
): string => {
  if (!detail) {
    return `
      <section id="factory-stream" class="grid p-5 content-start">
        <div class="min-h-[calc(100vh-40px)] grid place-items-center gap-3 text-center">
          <div>
            <div class="${kicker}">Factory Workspace</div>
            <h2 class="m-0 text-2xl font-semibold leading-tight mt-2">Select an objective</h2>
            <p class="m-0 text-muted-foreground text-sm leading-relaxed mt-1">The center workspace shows the activity stream for the selected objective.</p>
            <button type="button" class="${btnPrimary} mt-4" data-compose-open>Create Objective</button>
          </div>
        </div>
      </section>
    `;
  }

  const entries = mergeStreamEntries(detail, live);
  const historicEntries = entries.filter((e) => e.kind !== "live");

  return `
    <section id="factory-stream" class="grid gap-4 p-5 content-start" data-objective-id="${esc(detail.objectiveId)}">
      ${renderStreamHeader(detail)}
      ${renderBlockedAlert(detail)}
      <div class="grid gap-0">
        ${historicEntries.length
          ? historicEntries.map(renderStreamEntry).join("")
          : `<div class="${emptyText} py-4">No activity yet. Factory is processing.</div>`}
      </div>
      ${renderLiveSection(live)}
    </section>
  `;
};
