// ============================================================================
// Writer Guild constants
// ============================================================================

export const WRITER_WORKFLOW_ID = "writer-guild";
export const WRITER_WORKFLOW_VERSION = "0.1";

export const WRITER_TEAM = [
  { id: "orchestrator", name: "Orchestrator" },
  { id: "researcher_a", name: "Researcher A" },
  { id: "researcher_b", name: "Researcher B" },
  { id: "researcher_c", name: "Researcher C" },
  { id: "architect", name: "Architect" },
  { id: "drafter", name: "Drafter" },
  { id: "critic_logic", name: "Critic (Logic)" },
  { id: "critic_style", name: "Critic (Style)" },
  { id: "editor", name: "Editor" },
  { id: "synthesizer", name: "Synthesizer" },
];

export const WRITER_EXAMPLES = [
  { id: "manifesto", label: "Manifesto", problem: "Write a rigorous manifesto on why receipt-based systems are necessary for trustworthy AI." },
  { id: "case", label: "Case Study", problem: "Draft a case study on a product launch failure and how a receipt ledger would have prevented it." },
  { id: "brief", label: "Technical Brief", problem: "Create a technical brief explaining receipt-native orchestration for agent teams." },
];
