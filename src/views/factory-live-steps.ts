import { badgeToneClass, esc, formatTs, sectionLabelClass } from "./ui";
import type { FactoryLiveRunCard, FactoryRunStepTone } from "./factory-models";

const dotToneClass = (tone: FactoryRunStepTone): string => {
  switch (tone) {
    case "success":
      return "bg-success ring-4 ring-success/10";
    case "warning":
      return "bg-warning ring-4 ring-warning/10";
    case "danger":
      return "bg-destructive ring-4 ring-destructive/10";
    case "info":
      return "bg-info ring-4 ring-info/10";
    default:
      return "bg-muted-foreground/60 ring-4 ring-border";
  }
};

const renderStep = (
  step: NonNullable<FactoryLiveRunCard["steps"]>[number],
  latest: boolean,
): string => {
  const labelClass = badgeToneClass(step.tone);
  const dotClass = dotToneClass(step.tone);
  const activeClass = step.active || latest ? "animate-pulse" : "";
  return `<div class="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3 px-4 py-3 ${latest ? "bg-primary/5" : ""}">
    <div class="flex flex-col items-center">
      <span class="mt-1 flex h-2.5 w-2.5 shrink-0 rounded-full ${dotClass} ${activeClass}"></span>
    </div>
    <div class="min-w-0">
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] ${labelClass}">${esc(step.label)}</span>
        ${step.meta ? `<span class="text-[10px] text-muted-foreground">${esc(step.meta)}</span>` : ""}
        ${step.at ? `<span class="text-[10px] text-muted-foreground">${esc(formatTs(step.at))}</span>` : ""}
      </div>
      <div class="mt-1 text-sm leading-5 text-foreground">${esc(step.summary)}</div>
      ${step.detail ? `<div class="mt-1 text-xs leading-5 text-muted-foreground">${esc(step.detail)}</div>` : ""}
    </div>
  </div>`;
};

export const renderFactoryRunSteps = (
  run: FactoryLiveRunCard | undefined,
  options?: {
    readonly title?: string;
    readonly subtitle?: string;
  },
): string => {
  const steps = run?.steps ?? [];
  if (steps.length === 0) return "";
  const title = options?.title ?? "What's Happening";
  const subtitle = options?.subtitle ?? `${run?.profileLabel ?? "Factory"} is streaming recent reasoning steps for this thread.`;
  return `<section class="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
    <div class="flex items-start justify-between gap-3 border-b border-border/80 px-4 py-3">
      <div class="min-w-0">
        <div class="${sectionLabelClass}">${esc(title)}</div>
        <div class="mt-1 text-xs leading-5 text-muted-foreground">${esc(subtitle)}</div>
      </div>
      <div class="shrink-0 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">${esc(`${steps.length} step${steps.length === 1 ? "" : "s"}`)}</div>
    </div>
    <div class="divide-y divide-border/70">
      ${steps.map((step, index) => renderStep(step, index === steps.length - 1)).join("")}
    </div>
  </section>`;
};
