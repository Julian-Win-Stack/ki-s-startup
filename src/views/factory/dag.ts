import type { FactoryTaskView } from "./types.js";

const sanitize = (text: string): string =>
  text.replace(/[<>&"]/g, "").replace(/[\r\n]+/g, " ").slice(0, 60);

const mermaidLabel = (text: string): string =>
  `"${sanitize(text)}"`;

const statusToClass: Record<string, string> = {
  approved: "doneNode",
  integrated: "doneNode",
  completed: "doneNode",
  running: "runNode",
  dispatched: "runNode",
  blocked: "errNode",
  failed: "errNode",
  conflicted: "errNode",
  pending: "waitNode",
  ready: "waitNode",
};

const classForStatus = (status: string): string =>
  statusToClass[status] ?? "waitNode";

export const buildFactoryDag = (tasks: ReadonlyArray<FactoryTaskView>): string => {
  if (!tasks.length) return "";

  const nodeLines = tasks.map((t) =>
    `  ${t.taskId}[${mermaidLabel(t.title)}]`,
  );

  const edgeLines = tasks.flatMap((t) =>
    t.dependsOn.map((dep) => `  ${dep} --> ${t.taskId}`),
  );

  const byClass = new Map<string, string[]>();
  for (const t of tasks) {
    const cls = classForStatus(t.status);
    const existing = byClass.get(cls) ?? [];
    existing.push(t.taskId);
    byClass.set(cls, existing);
  }

  const classLines = [
    "  classDef doneNode fill:#173224,stroke:#4fbf7c,color:#f3f5f7,stroke-width:2px;",
    "  classDef runNode fill:#1a2332,stroke:#5b9bd5,color:#f3f5f7,stroke-width:2px;",
    "  classDef errNode fill:#2d1a1a,stroke:#d45b5b,color:#f3f5f7,stroke-width:2px;",
    "  classDef waitNode fill:#1a1a1a,stroke:#555,color:#999,stroke-width:1px;",
  ];

  const assignLines = [...byClass.entries()]
    .filter(([, ids]) => ids.length > 0)
    .map(([cls, ids]) => `  class ${ids.join(",")} ${cls};`);

  return [
    "flowchart TD",
    ...classLines,
    ...nodeLines,
    ...edgeLines,
    ...assignLines,
  ].join("\n");
};
