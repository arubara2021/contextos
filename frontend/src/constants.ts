import type {
  ConceptType,
  CortexDocumentState,
  CortexFilterMode,
  CortexMemoryLinkState,
  CortexViewMode,
  RelationshipType,
  StrengthCategory,
} from "./types";

export const APP_NAME = "ContextOS";

export const ROUTES = {
  cortex: "/cortex",
  dive: "/dive",
  archive: "/archive",
  settings: "/settings",
  onboarding: "/onboarding",
  login: "/login",
  signup: "/signup",
} as const;

export const STORAGE_KEYS = {
  token: "contextos.token",
  user: "contextos.user",
  lastSession: "contextos.lastSession",
  cortexLayout: "contextos.cortexLayout",
  cortexView: "contextos.cortexView",
  cortexActiveDocument: "contextos.cortexActiveDocument",
  cortexLinkFilter: "contextos.cortexLinkFilter",
  cortexFilters: "contextos.cortexFilters",
} as const;

export const CORTEX_LAYOUTS = ["constellation", "orbit", "timeline"] as const;
export type CortexLayout = (typeof CORTEX_LAYOUTS)[number];

export const CORTEX_VIEW_MODES: readonly CortexViewMode[] = [
  "core",
  "document",
] as const;

export const CORTEX_FILTER_MODES: readonly CortexFilterMode[] = [
  "all",
  "linked",
  "islands",
] as const;

export const CORTEX_CORE_NODE_ID = "core:main";
export const CORTEX_DOCUMENT_NODE_PREFIX = "doc:";

export const CORTEX_DOCUMENT_STATE_LABELS: Record<CortexDocumentState, string> = {
  connected: "Connected",
  solo: "Solo",
  processing: "Processing",
  empty: "Empty",
};

export const CORTEX_MEMORY_LINK_LABELS: Record<CortexMemoryLinkState, string> = {
  linked: "Linked",
  island: "Island",
};

export const CORTEX_FILTER_LABELS: Record<CortexFilterMode, string> = {
  all: "All",
  linked: "Linked",
  islands: "Islands",
};

export const STRENGTH_CATEGORIES: Record<
  StrengthCategory,
  { label: string; min: number; color: string; glow: string }
> = {
  strong: {
    label: "Strong",
    min: 0.7,
    color: "#FF8A3D",
    glow: "rgba(255, 138, 61, 0.55)",
  },
  fading: {
    label: "Fading",
    min: 0.4,
    color: "#B06F3A",
    glow: "rgba(176, 111, 58, 0.35)",
  },
  critical: {
    label: "Critical",
    min: 0.1,
    color: "#FF5C49",
    glow: "rgba(255, 92, 73, 0.5)",
  },
  forgotten: {
    label: "Forgotten",
    min: 0,
    color: "#57504A",
    glow: "rgba(87, 80, 74, 0.15)",
  },
};

export const CATEGORY_ORDER: StrengthCategory[] = [
  "strong",
  "fading",
  "critical",
  "forgotten",
];

export function strengthCategory(strength: number): StrengthCategory {
  if (strength >= STRENGTH_CATEGORIES.strong.min) return "strong";
  if (strength >= STRENGTH_CATEGORIES.fading.min) return "fading";
  if (strength >= STRENGTH_CATEGORIES.critical.min) return "critical";
  return "forgotten";
}

export const CONCEPT_TYPES: Record<
  ConceptType,
  { label: string; color: string; priority: number }
> = {
  decision: { label: "Decision", color: "#FF8A3D", priority: 1 },
  problem: { label: "Problem", color: "#FF5C49", priority: 2 },
  fact: { label: "Fact", color: "#8FD8D2", priority: 3 },
  code: { label: "Code", color: "#9DB98A", priority: 4 },
  entity: { label: "Entity", color: "#F4D06F", priority: 5 },
  event: { label: "Event", color: "#86B4E8", priority: 6 },
  preference: { label: "Preference", color: "#E39AB8", priority: 7 },
};

export const CONCEPT_TYPE_ORDER: ConceptType[] = [
  "fact",
  "decision",
  "problem",
  "code",
  "entity",
  "event",
  "preference",
];

export const RELATIONSHIP_TYPES: Record<
  RelationshipType,
  {
    label: string;
    inverseLabel: string;
    symbol: string;
    directed: boolean;
    dash: number[];
    color: string;
  }
> = {
  causes: {
    label: "Causes",
    inverseLabel: "Caused by",
    symbol: "→",
    directed: true,
    dash: [],
    color: "rgba(255, 138, 61, 0.5)",
  },
  evolves_into: {
    label: "Evolves into",
    inverseLabel: "Evolved from",
    symbol: "⇝",
    directed: true,
    dash: [8, 5],
    color: "rgba(157, 185, 138, 0.5)",
  },
  replaces: {
    label: "Replaces",
    inverseLabel: "Replaced by",
    symbol: "⇒",
    directed: true,
    dash: [3, 3],
    color: "rgba(255, 92, 73, 0.45)",
  },
  part_of: {
    label: "Part of",
    inverseLabel: "Contains",
    symbol: "⊂",
    directed: true,
    dash: [12, 4, 2, 4],
    color: "rgba(134, 180, 232, 0.45)",
  },
  requires: {
    label: "Requires",
    inverseLabel: "Required by",
    symbol: "⊨",
    directed: true,
    dash: [2, 3],
    color: "rgba(227, 154, 184, 0.45)",
  },
  // FIX 4: was rgba(236, 229, 218, 0.16) — invisible on the void background.
  related_to: {
    label: "Related to",
    inverseLabel: "Related to",
    symbol: "↔",
    directed: false,
    dash: [2, 5],
    color: "rgba(236, 229, 218, 0.38)",
  },
};

export const DECAY_THRESHOLDS = {
  strong: 0.7,
  fading: 0.4,
  forgotten: 0.1,
  retainWeight: 0.7,
  accessBoostWeight: 0.3,
} as const;

export const FORGETTING_BUDGET_MAX = 20;
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const JOB_POLL_INTERVAL_MS = 3000;
export const REMINDER_POLL_INTERVAL_MS = 60000;
export const STATS_REFRESH_INTERVAL_MS = 30000;

