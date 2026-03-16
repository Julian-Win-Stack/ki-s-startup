import { cn } from "../../lib/cn.js";
import type { FactoryBoardProjection } from "./types.js";
import {
  btnPrimary,
  esc,
  factoryQuery,
  formatClock,
  kicker,
  statusClass,
  truncate,
} from "./widgets.js";

// ── Objective row ────────────────────────────────────────────────────────────

const dotColor = (phase: string, status: string): string => {
  if (phase === "blocked" || status === "blocked") return "bg-destructive";
  const k = statusClass(phase);
  if (["promoting", "promoted", "completed"].includes(k)) return "bg-[oklch(0.65_0.15_145)]";
  if (["executing", "running"].includes(k)) return "bg-[oklch(0.7_0.12_230)]";
  return "bg-muted-foreground/40";
};

const renderObjectiveRow = (
  card: FactoryBoardProjection["objectives"][number],
  activeId?: string,
): string => {
  const isActive = card.objectiveId === activeId;
  const isBlocked = card.phase === "blocked" || card.status === "blocked";
  return `
    <a class="${cn(
      "flex items-start gap-2.5 py-2.5 px-4 no-underline text-inherit border-l-2 border-transparent transition-colors hover:bg-muted",
      isActive && "bg-muted border-l-primary",
      isBlocked && "border-l-destructive",
    )}" href="/factory${factoryQuery(card.objectiveId)}">
      <span class="${cn("shrink-0 size-[7px] rounded-full mt-[5px]", dotColor(card.phase, card.status))}" title="${esc(card.phase)}"></span>
      <div class="grid gap-px min-w-0">
        <span class="text-[13px] font-medium leading-tight truncate">${esc(truncate(card.title, 64))}</span>
        <span class="text-[11px] text-muted-foreground font-mono">${card.activeTaskCount}/${card.taskCount} tasks · ${esc(formatClock(card.updatedAt))}</span>
      </div>
    </a>
  `;
};

// ── Section label ────────────────────────────────────────────────────────────

const renderSection = (
  label: string,
  cards: ReadonlyArray<FactoryBoardProjection["objectives"][number]>,
  activeId?: string,
): string => {
  if (!cards.length) return "";
  return `
    <div>
      <div class="flex items-center gap-1.5 px-4 pt-2 pb-1 text-[10px] font-semibold tracking-[0.1em] uppercase text-muted-foreground">
        ${esc(label)} <span class="font-mono text-muted-foreground/60">${cards.length}</span>
      </div>
      ${cards.map((c) => renderObjectiveRow(c, activeId)).join("")}
    </div>
  `;
};

// ── Board island ─────────────────────────────────────────────────────────────

export const factoryBoardIsland = (board: FactoryBoardProjection): string => `
  <section id="factory-board" class="rail-panel grid content-start">
    <div class="p-4 pb-3 grid gap-3 border-b border-border">
      <div>
        <div class="${kicker}">Command Center</div>
        <h1 class="m-0 text-lg font-bold leading-tight mt-1">Factory</h1>
      </div>
      <button type="button" class="${btnPrimary} w-full text-sm py-2" data-compose-open>New Objective</button>
    </div>
    <nav class="grid">
      ${renderSection("Needs Attention", board.sections.needs_attention, board.selectedObjectiveId)}
      ${renderSection("Active", board.sections.active, board.selectedObjectiveId)}
      ${renderSection("Queued", board.sections.queued, board.selectedObjectiveId)}
      ${renderSection("Completed", board.sections.completed, board.selectedObjectiveId)}
    </nav>
  </section>
`;
