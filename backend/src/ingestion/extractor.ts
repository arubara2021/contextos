import {
  Concept,
  RawConceptFromAI,
  createConceptFromRaw,
} from "../models/concept.model";
import type { NormalizedChunk } from "./normalizer";
import config from "../config";
import logger from "../utils/logger";

export interface ExtractionResult {
  concepts: Concept[];
  chunksProcessed: number;
  chunksFailed: number;
  extractionTimeMs: number;
}

export interface RawConceptValidationOptions {
  existingLabels?: string[];
  maxConcepts?: number;
  minImportance?: number;
  maxRelated?: number;
}

interface CandidateConcept {
  label: string;
  definition: string;
  significance: string;
  type: string;
  importance: number;
  related: unknown;
}

const MAX_RELATED_PER_CONCEPT = Number(
  (config.extraction as any).maxRelatedPerConcept ?? 4
);

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const GENERIC_STOP = new Set([
  "the", "and", "for", "that", "this", "with", "from", "into", "about",
  "within", "between", "through", "during", "their", "there", "these",
  "those", "which", "while", "where", "when", "what", "how", "why", "who",
  "does", "done", "being", "have", "has", "had", "also", "just", "only",
  "very", "much", "more", "most", "some", "any", "such", "each", "every",
  "both", "than", "then", "onto", "upon", "over", "under", "against",
  "among", "across", "after", "before", "because", "although", "however",
  "therefore", "thus", "hence", "process", "system", "concept", "model",
]);

const FRAGMENT_VERBS = new Set([
  "is", "are", "was", "were", "be", "been", "being",
  "has", "have", "had", "does", "do", "did",
  "can", "could", "will", "would", "shall", "should", "may", "might",
  "manages", "manage", "retains", "retain", "utilizes", "utilize",
  "includes", "include", "provides", "provide", "allows", "allow",
  "enables", "enable", "uses", "use", "used", "using",
  "makes", "make", "helps", "help", "shows", "show",
  "describes", "describe", "contains", "contain",
  "requires", "require", "supports", "support",
]);

const TRAILING_CONNECTORS = new Set([
  "for", "of", "the", "a", "an", "in", "on", "to", "with", "by",
  "that", "which", "from", "into", "about", "and", "or", "as", "at",
]);

const LEADING_FRAGMENT =
  /^(it|this|that|these|those|there|here|they|we|you|he|she)\s+/i;

const BOILERPLATE_WRAPPER =
  /^(?:the\s+)?(?:process|act|practice|concept|idea|system|method|notion)\s+of\s+([a-z]+)/i;

function contentWords(text: string): string[] {
  return normalizeLabel(text)
    .split(" ")
    .filter((w) => w.length > 3 && !GENERIC_STOP.has(w));
}

function stripAffix(word: string): string {
  return word
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .replace(/(ing|tion|ment|ence|ance|ness|ity|ies|es|s)$/, "");
}

export function isFragmentLabel(label: string): boolean {
  const trimmed = label.trim();

  if (trimmed.length < 3) return true;
  if (trimmed.length > 80) return true;

  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length > 6) return true;

  if (/[!?;]/.test(trimmed)) return true;
  if (/,\s/.test(trimmed)) return true;
  if (/\.\s/.test(trimmed)) return true;

  const last = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, "");
  if (TRAILING_CONNECTORS.has(last)) return true;

  if (LEADING_FRAGMENT.test(trimmed) && words.length >= 3) return true;

  const hasVerb = words.some((w) =>
    FRAGMENT_VERBS.has(w.toLowerCase().replace(/[^a-z]/g, ""))
  );
  if (hasVerb && words.length >= 3) return true;

  if (words.length === 1) {
    const single = words[0].toLowerCase().replace(/[^a-z]/g, "");
    if (GENERIC_STOP.has(single)) return true;
  }

  return false;
}

export function definitionRestatesLabel(
  label: string,
  definition: string
): boolean {
  const lab = contentWords(label);
  const def = contentWords(definition);

  if (def.length === 0) return true;

  const labSet = new Set(lab);
  let newWords = 0;

  for (const w of def) {
    if (!labSet.has(w)) newWords++;
  }

  if (newWords < 3) return true;

  const defSet = new Set(def);
  let labInDef = 0;

  for (const w of lab) {
    if (defSet.has(w)) labInDef++;
  }

  const overlap = lab.length > 0 ? labInDef / lab.length : 0;
  if (overlap >= 0.5 && newWords < 4) return true;

  const wrapper = definition.trim().match(BOILERPLATE_WRAPPER);
  if (wrapper) {
    const gerund = stripAffix(wrapper[1]);

    if (gerund.length >= 3) {
      const labJoined = lab.join("");
      const stemsMatch =
        labJoined.includes(gerund) ||
        lab.some(
          (w) =>
            w.startsWith(gerund) ||
            gerund.startsWith(w.slice(0, 4)) ||
            stripAffix(w) === gerund
        );

      if (stemsMatch) return true;
    }
  }

  const labRaw = label.toLowerCase().trim();
  const defRaw = definition.toLowerCase();

  if (labRaw.length >= 4 && defRaw === labRaw) {
    return true;
  }

  if (
    labRaw.length >= 4 &&
    defRaw.includes(labRaw) &&
    defRaw.length < labRaw.length * 4
  ) {
    return true;
  }

  return false;
}

export function isLowQualityConcept(
  label: string,
  definition: string
): boolean {
  if (!label || label.trim().length < 3) return true;
  if (!definition || definition.trim().length < 12) return true;
  if (isFragmentLabel(label)) return true;
  if (definitionRestatesLabel(label, definition)) return true;
  return false;
}

function isValidConceptType(type: string): boolean {
  return [
    "problem",
    "decision",
    "fact",
    "entity",
    "event",
    "preference",
    "code",
  ].includes(type);
}

function clampImportance(value: unknown): number {
  const num = typeof value === "number" ? value : parseInt(String(value), 10);
  if (isNaN(num)) return 5;
  return Math.max(1, Math.min(10, Math.round(num)));
}

function normalizeConceptType(type: unknown): string {
  if (typeof type !== "string") return "fact";

  const lower = type.toLowerCase().trim();
  if (isValidConceptType(lower)) return lower;

  if (
    lower.includes("problem") ||
    lower.includes("issue") ||
    lower.includes("bug")
  ) {
    return "problem";
  }

  if (
    lower.includes("decision") ||
    lower.includes("choice") ||
    lower.includes("chose")
  ) {
    return "decision";
  }

  if (
    lower.includes("entity") ||
    lower.includes("person") ||
    lower.includes("org")
  ) {
    return "entity";
  }

  if (
    lower.includes("event") ||
    lower.includes("happened") ||
    lower.includes("occurred")
  ) {
    return "event";
  }

  if (
    lower.includes("preference") ||
    lower.includes("prefer") ||
    lower.includes("like")
  ) {
    return "preference";
  }

  if (
    lower.includes("code") ||
    lower.includes("function") ||
    lower.includes("api")
  ) {
    return "code";
  }

  return "fact";
}

function cleanString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";

  let cleaned = value.trim();
  cleaned = cleaned.replace(/["""]/g, "");
  cleaned = cleaned.replace(/\s+/g, " ");

  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength);
  }

  return cleaned;
}

function cleanLabel(label: unknown): string {
  let cleaned = cleanString(label, 120);

  cleaned = cleaned.replace(/^[\s]*[-*\u2022]+\s+/, "");
  cleaned = cleaned.replace(/^\d+[.)]\s+/, "");
  cleaned = cleaned.replace(/[.!?;]+$/g, "");

  return cleaned.trim();
}

function cleanDefinition(def: unknown): string {
  return cleanString(def, 2000);
}

function cleanSignificance(value: unknown): string {
  return cleanString(value, 1000);
}

function cleanRelatedWhitelist(
  related: unknown,
  sourceLabel: string,
  allowed: Set<string>,
  maxRelated: number
): string[] {
  let input: unknown[] = [];

  if (Array.isArray(related)) {
    input = related;
  } else if (typeof related === "string") {
    input = related.split(",");
  }

  const sourceKey = normalizeLabel(sourceLabel);
  const cleaned: string[] = [];
  const seen = new Set<string>();

  for (const item of input) {
    if (typeof item !== "string") continue;

    const label = cleanLabel(item);
    if (label.length < 2 || label.length > 120) continue;

    const key = normalizeLabel(label);
    if (!key || key === sourceKey) continue;

    if (allowed.size > 0 && !allowed.has(key)) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    cleaned.push(label);

    if (cleaned.length >= maxRelated) break;
  }

  return cleaned;
}

function parseJsonArraySafe(input: string): unknown[] {
  const trimmed = (input || "").trim();
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {}
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  const objectMatches = trimmed.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  if (objectMatches && objectMatches.length > 0) {
    const results: unknown[] = [];

    for (const match of objectMatches) {
      try {
        const parsed = JSON.parse(match);
        if (parsed && typeof parsed === "object") {
          results.push(parsed);
        }
      } catch {}
    }

    if (results.length > 0) return results;
  }

  return [];
}

export function parseAndValidateRawConcepts(
  rawItems: unknown[],
  source: string,
  options?: RawConceptValidationOptions
): Concept[] {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];

  const maxConcepts =
    options?.maxConcepts ?? config.extraction.maxConceptsPerDocument;

  const minImportance =
    options?.minImportance ?? config.extraction.minConceptImportance;

  const maxRelated =
    options?.maxRelated ??
    (Number.isFinite(MAX_RELATED_PER_CONCEPT) && MAX_RELATED_PER_CONCEPT > 0
      ? MAX_RELATED_PER_CONCEPT
      : 4);

  const existingNormalized = new Set(
    (options?.existingLabels ?? [])
      .map((label) => normalizeLabel(String(label || "")))
      .filter((key) => key.length > 0)
  );

  const candidates: CandidateConcept[] = [];

  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;

    const obj = item as Record<string, unknown>;

    const label = cleanLabel(obj.label);
    const definition = cleanDefinition(obj.definition);

    if (!label || label.length < 2) continue;
    if (!definition || definition.length < 12) continue;
    if (isLowQualityConcept(label, definition)) continue;

    const conceptType = normalizeConceptType(obj.type);
    const importance = clampImportance(obj.importance);

    if (importance < minImportance) continue;

    const significance = cleanSignificance(obj.significance);

    candidates.push({
      label,
      definition,
      significance,
      type: conceptType,
      importance,
      related: obj.related,
    });
  }

  candidates.sort((a, b) => b.importance - a.importance);

  const deduped = new Map<string, CandidateConcept>();

  for (const candidate of candidates) {
    const key = normalizeLabel(candidate.label);
    if (!key) continue;

    const existing = deduped.get(key);

    if (!existing) {
      deduped.set(key, candidate);
      continue;
    }

    if (
      candidate.importance > existing.importance ||
      (candidate.importance === existing.importance &&
        candidate.definition.length > existing.definition.length)
    ) {
      deduped.set(key, candidate);
    }
  }

  const accepted = Array.from(deduped.values())
    .sort((a, b) => b.importance - a.importance)
    .slice(0, maxConcepts);

  const acceptedNormalized = new Set(
    accepted
      .map((candidate) => normalizeLabel(candidate.label))
      .filter((key) => key.length > 0)
  );

  const allowedRelated = new Set<string>([
    ...acceptedNormalized,
    ...existingNormalized,
  ]);

  const concepts: Concept[] = [];

  for (const candidate of accepted) {
    const related = cleanRelatedWhitelist(
      candidate.related,
      candidate.label,
      allowedRelated,
      maxRelated
    );

    const raw: RawConceptFromAI = {
      label: candidate.label,
      definition: candidate.definition,
      significance: candidate.significance || undefined,
      type: candidate.type,
      importance: candidate.importance,
      related,
    };

    const concept = createConceptFromRaw(raw, source);
    if (!concept) continue;
    if (isLowQualityConcept(concept.label, concept.definition)) continue;

    concepts.push(concept);
  }

  return concepts;
}

export class ConceptExtractor {
  parseAndValidateConcepts(
    responseText: string,
    source: string,
    options?: RawConceptValidationOptions
  ): Concept[] {
    const rawItems = parseJsonArraySafe(responseText);
    return parseAndValidateRawConcepts(rawItems, source, options);
  }

  extractFromChunks(
    chunks: NormalizedChunk[],
    source?: string
  ): ExtractionResult {
    logger.warn(
      "extractFromChunks is deprecated. Use processDocumentExtraction from smart-processor instead."
    );

    return {
      concepts: [],
      chunksProcessed: chunks.length,
      chunksFailed: 0,
      extractionTimeMs: 0,
    };
  }

  deduplicateConcepts(concepts: Concept[]): Concept[] {
    const seen = new Map<string, Concept>();

    for (const concept of concepts) {
      const key = normalizeLabel(concept.label);
      const existing = seen.get(key);

      if (!existing) {
        seen.set(key, concept);
      } else if (concept.importance > existing.importance) {
        seen.set(key, concept);
      }
    }

    return Array.from(seen.values());
  }
}

let extractorInstance: ConceptExtractor | null = null;

export function getExtractor(): ConceptExtractor {
  if (!extractorInstance) {
    extractorInstance = new ConceptExtractor();
  }
  return extractorInstance;
}