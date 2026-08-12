export interface RawConceptFromAI {
  label?: unknown;
  definition?: unknown;
  significance?: unknown;
  type?: unknown;
  importance?: unknown;
  related?: unknown;
}

export interface Concept {
  label: string;
  definition: string;
  significance: string;
  conceptType: string;
  importance: number;
  source: string;
  related: string[];
  embedding: number[] | null;
}

export type ConceptType =
  | "problem"
  | "decision"
  | "fact"
  | "entity"
  | "event"
  | "preference"
  | "code";

const VALID_TYPES = new Set([
  "problem",
  "decision",
  "fact",
  "entity",
  "event",
  "preference",
  "code",
]);

export function isConceptType(value: string): value is ConceptType {
  return VALID_TYPES.has(value.toLowerCase().trim());
}

function normalizeType(type: unknown): string {
  if (typeof type !== "string") return "fact";
  const lower = type.toLowerCase().trim();
  if (VALID_TYPES.has(lower)) return lower;
  if (lower.includes("problem") || lower.includes("issue") || lower.includes("bug"))
    return "problem";
  if (lower.includes("decision") || lower.includes("choice") || lower.includes("chose"))
    return "decision";
  if (lower.includes("entity") || lower.includes("person") || lower.includes("org"))
    return "entity";
  if (lower.includes("event") || lower.includes("happened") || lower.includes("occurred"))
    return "event";
  if (lower.includes("preference") || lower.includes("prefer") || lower.includes("like"))
    return "preference";
  if (lower.includes("code") || lower.includes("function") || lower.includes("api"))
    return "code";
  return "fact";
}

function cleanString(value: unknown, maxLength: number = 1000): string {
  if (typeof value !== "string") return "";
  let cleaned = value.trim();
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.slice(1, -1);
  }
  if (cleaned.startsWith("'") && cleaned.endsWith("'")) {
    cleaned = cleaned.slice(1, -1);
  }
  cleaned = cleaned.replace(/\s+/g, " ");
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength);
  }
  return cleaned;
}

function clampImportance(value: unknown): number {
  const num = typeof value === "number" ? value : parseInt(String(value), 10);
  if (isNaN(num)) return 5;
  return Math.max(1, Math.min(10, Math.round(num)));
}

function normalizeArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, 20);
}

export function createConceptFromRaw(
  raw: RawConceptFromAI,
  source: string
): Concept | null {
  if (!raw || typeof raw !== "object") return null;

  const label = cleanString(raw.label, 200);
  const definition = cleanString(raw.definition, 2000);
  const significance = cleanString(raw.significance, 500);

  if (!label || label.length < 2) return null;
  if (!definition || definition.length < 5) return null;

  const conceptType = normalizeType(raw.type);
  const importance = clampImportance(raw.importance);
  const related = normalizeArray(raw.related);

  return {
    label,
    definition,
    significance,
    conceptType,
    importance,
    source,
    related,
    embedding: null,
  };
}

export function conceptToText(concept: Concept): string {
  const parts: string[] = [`${concept.label}: ${concept.definition}`];

  if (concept.significance && concept.significance.length > 0) {
    parts.push(`SIGNIFICANCE: ${concept.significance}`);
  }

  if (concept.related && concept.related.length > 0) {
    parts.push(`RELATED: ${concept.related.join(", ")}`);
  }

  return parts.join(" ");
}

export function isValidConceptType(type: string): boolean {
  return VALID_TYPES.has(type);
}

export function getDefaultConcept(): Concept {
  return {
    label: "",
    definition: "",
    significance: "",
    conceptType: "fact",
    importance: 5,
    source: "",
    related: [],
    embedding: null,
  };
}