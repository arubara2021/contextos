import type { RawConceptFromAI } from "../agent/bedrock-client";
import { AIError, parseJsonArray } from "../agent/ai-provider";
import config from "../config";
import logger from "../utils/logger";
import {
  buildDocumentExtractionPrompt,
  buildConversationExtractionSystemPrompt,
  buildSingleMessageExtractionSystemPrompt,
} from "../prompts/extraction-prompt";

export interface ExistingMemoryContext {
  label: string;
  definition?: string | null;
  conceptType?: string;
  importance?: number;
}

export interface DocumentExtractionOptions {
  existingMemories?: ExistingMemoryContext[];
  maxConcepts?: number;
}

export interface SmartExtractionResult {
  concepts: RawConceptFromAI[];
  totalTimeMs: number;
  aiTimeMs: number;
  parseTimeMs: number;
  conceptCount: number;
  warnings: string[];
  sectionCount: number;
  aiCalls: number;
  rawConceptCount: number;
  acceptedConceptCount: number;
  existingMemoriesProvided: number;
}

export interface AIClient {
  sendMessage(systemPrompt: string, userMessage: string): Promise<string>;
  sendExtraction?(systemPrompt: string, userMessage: string): Promise<string>;
}

interface DocumentSection {
  heading: string | null;
  text: string;
}

interface SectionResult {
  concepts: RawConceptFromAI[];
  aiTimeMs: number;
  parseTimeMs: number;
  error?: string;
}

function wordCountOf(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function normalizeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function existingMemoryLimit(): number {
  const value = Number(config.extraction.existingMemoryLimit);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 40;
}

function maxRelatedPerConcept(): number {
  const value = Number(config.extraction.maxRelatedPerConcept);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 4;
}

function sectionCharCap(): number {
  const value = Number(config.extraction.sectionCharCap);
  return Number.isFinite(value) && value > 1000 ? Math.floor(value) : 8000;
}

function maxSectionChars(): number {
  return Math.floor(sectionCharCap() * 1.2);
}

function singleCallThreshold(): number {
  const value = Number(config.extraction.singleCallCharThreshold);
  return Number.isFinite(value) && value > 1000 ? Math.floor(value) : 6000;
}

function minSectionChars(): number {
  const value = Number(config.extraction.minSectionChars);
  return Number.isFinite(value) && value > 100 ? Math.floor(value) : 500;
}

function maxSections(): number {
  const value = Number(config.extraction.maxSections);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 20;
}

function sectionConcurrency(): number {
  const value = Number(config.extraction.sectionConcurrency);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
}

function looksLikeHeading(line: string): boolean {
  const t = line.trim();

  if (!t || t.length > 120) return false;

  if (/^#{1,6}\s+/.test(t)) return true;

  if (/^\d+(\.\d+)*\.?\s+[A-Z]/.test(t)) return true;

  if (
    /^(abstract|introduction|method|methods|methodology|results?|discussion|conclusion|related work|references|background|experiments?|evaluation|appendix|preliminaries|setup)\b/i.test(
      t
    )
  ) {
    return true;
  }

  if (t === t.toUpperCase() && /[A-Z]/.test(t) && t.length >= 4 && t.length <= 60) {
    return true;
  }

  return false;
}

function cleanHeading(line: string): string {
  return line
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/^\d+(\.\d+)*\.?\s*/, "")
    .trim();
}

function hardSplit(text: string, cap: number): string[] {
  const parts: string[] = [];
  let rest = text;

  while (rest.length > cap) {
    let cut = rest.lastIndexOf(". ", cap);

    if (cut < cap * 0.5) cut = rest.lastIndexOf("\n", cap);

    if (cut < cap * 0.5) cut = cap;
    else cut += 1;

    parts.push(rest.substring(0, cut).trim());
    rest = rest.substring(cut).trim();
  }

  if (rest.length > 0) parts.push(rest);

  return parts.filter((p) => p.length > 0);
}

function packParagraphs(paragraphs: string[], cap: number): string[] {
  const sections: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    if (para.length > cap) {
      if (current.length > 0) {
        sections.push(current);
        current = "";
      }

      for (const piece of hardSplit(para, cap)) {
        sections.push(piece);
      }

      continue;
    }

    if (current.length + para.length + 2 > cap) {
      if (current.length > 0) sections.push(current);
      current = para;
    } else {
      current = current.length > 0 ? `${current}\n${para}` : para;
    }
  }

  if (current.length > 0) sections.push(current);

  return sections;
}

function splitByParagraphWindows(text: string): DocumentSection[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return hardSplit(text, sectionCharCap()).map((t) => ({
      heading: null,
      text: t,
    }));
  }

  return packParagraphs(paragraphs, sectionCharCap()).map((t) => ({
    heading: null,
    text: t,
  }));
}

function enforceSectionCaps(sections: DocumentSection[]): DocumentSection[] {
  const cap = sectionCharCap();
  const maxChars = maxSectionChars();
  const result: DocumentSection[] = [];

  for (const section of sections) {
    if (section.text.length <= maxChars) {
      result.push(section);
      continue;
    }

    const pieces = hardSplit(section.text, cap);

    pieces.forEach((piece, index) => {
      result.push({
        heading:
          index === 0
            ? section.heading
            : `${section.heading || "Section"} (cont.)`,
        text: piece,
      });
    });
  }

  return result;
}

function finalizeSections(sections: DocumentSection[]): DocumentSection[] {
  const merged: DocumentSection[] = [];
  const minChars = minSectionChars();
  const maxChars = maxSectionChars();

  for (const sec of sections) {
    if (sec.text.length < minChars && merged.length > 0) {
      const last = merged[merged.length - 1];

      if (last.text.length + sec.text.length + 2 <= maxChars) {
        last.text = `${last.text}\n${sec.text}`;

        if (!last.heading && sec.heading) {
          last.heading = sec.heading;
        }

        continue;
      }
    }

    merged.push({ heading: sec.heading, text: sec.text });
  }

  if (merged.length === 0) {
    return [{ heading: null, text: sections.map((s) => s.text).join("\n") }];
  }

  return merged;
}

function mergeSectionsToLimit(sections: DocumentSection[]): DocumentSection[] {
  const limit = maxSections();
  const maxChars = maxSectionChars();

  let result = [...sections];

  while (result.length > limit) {
    let bestIndex = -1;
    let bestLength = Infinity;

    for (let i = 0; i < result.length - 1; i++) {
      const combinedLength =
        result[i].text.length + result[i + 1].text.length + 2;

      if (combinedLength <= maxChars && combinedLength < bestLength) {
        bestLength = combinedLength;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) break;

    const mergedSection: DocumentSection = {
      heading: result[bestIndex].heading ?? result[bestIndex + 1].heading,
      text: `${result[bestIndex].text}\n${result[bestIndex + 1].text}`,
    };

    result.splice(bestIndex, 2, mergedSection);
  }

  return result;
}

function splitDocumentIntoSections(text: string): DocumentSection[] {
  const trimmed = text.trim();

  if (trimmed.length <= singleCallThreshold()) {
    return [{ heading: null, text: trimmed }];
  }

  const lines = trimmed.split("\n");
  const headingSections: DocumentSection[] = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];
  let foundHeading = false;

  const flush = () => {
    const body = currentBody.join("\n").trim();

    if (body.length > 0) {
      headingSections.push({ heading: currentHeading, text: body });
    }

    currentBody = [];
  };

  for (const line of lines) {
    if (looksLikeHeading(line)) {
      flush();
      currentHeading = cleanHeading(line);
      foundHeading = true;
    } else {
      currentBody.push(line);
    }
  }

  flush();

  if (!foundHeading || headingSections.length <= 1) {
    return finalizeSections(
      enforceSectionCaps(splitByParagraphWindows(trimmed))
    );
  }

  const expanded: DocumentSection[] = [];

  for (const sec of headingSections) {
    if (sec.text.length <= maxSectionChars()) {
      expanded.push(sec);
      continue;
    }

    const paragraphs = sec.text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const packed =
      paragraphs.length > 1
        ? packParagraphs(paragraphs, sectionCharCap())
        : hardSplit(sec.text, sectionCharCap());

    packed.forEach((piece, idx) => {
      expanded.push({
        heading: idx === 0 ? sec.heading : `${sec.heading || "Section"} (cont.)`,
        text: piece,
      });
    });
  }

  return mergeSectionsToLimit(finalizeSections(enforceSectionCaps(expanded)));
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);

  if (items.length === 0) return results;

  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = nextIndex;
        nextIndex += 1;

        if (i >= items.length) return;

        results[i] = await worker(items[i], i);
      }
    }
  );

  await Promise.all(runners);

  return results;
}

async function callAI(
  aiClient: AIClient,
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const invoke = (
    aiClient.sendExtraction ? aiClient.sendExtraction : aiClient.sendMessage
  ).bind(aiClient);

  return invoke(systemPrompt, userPrompt);
}

function filterValidRaw(items: unknown[]): RawConceptFromAI[] {
  return items.filter((item): item is RawConceptFromAI => {
    if (!item || typeof item !== "object") return false;

    const obj = item as Record<string, unknown>;

    if (typeof obj.label !== "string" || obj.label.trim().length === 0) {
      return false;
    }

    if (typeof obj.definition !== "string" || obj.definition.trim().length === 0) {
      return false;
    }

    return true;
  });
}

function parseConceptsFromResponse(response: string): RawConceptFromAI[] {
  try {
    const parsed = parseJsonArray<RawConceptFromAI>(response);
    return filterValidRaw(parsed);
  } catch {
    return [];
  }
}

const STRUCTURAL_SECTION_LABELS = new Set([
  "conclusion",
  "conclusions",
  "related work",
  "references",
  "acknowledgments",
  "bibliography",
  "appendix",
  "table of contents",
  "abstract",
  "introduction",
  "overview",
  "summary",
]);

function filterStructuralSections(
  concepts: RawConceptFromAI[]
): RawConceptFromAI[] {
  return concepts.filter((c) => {
    const label = String(c.label || "").trim().toLowerCase();
    return !STRUCTURAL_SECTION_LABELS.has(label);
  });
}

function importanceOf(raw: RawConceptFromAI): number {
  const value = (raw as Record<string, unknown>).importance;
  const num = typeof value === "number" ? value : parseInt(String(value), 10);
  return isNaN(num) ? 0 : num;
}

function dedupeRawConcepts(items: RawConceptFromAI[]): RawConceptFromAI[] {
  const map = new Map<string, RawConceptFromAI>();

  for (const item of items) {
    const label = String(item.label || "").trim();

    if (!label) continue;

    const key = normalizeKey(label);

    if (!key) continue;

    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      continue;
    }

    const imp = importanceOf(item);
    const existingImp = importanceOf(existing);
    const defLen = String(item.definition || "").length;
    const existingDefLen = String(existing.definition || "").length;

    if (imp > existingImp || (imp === existingImp && defLen > existingDefLen)) {
      map.set(key, item);
    }
  }

  return Array.from(map.values());
}

function cleanRelatedInRaw(
  items: RawConceptFromAI[],
  existingMemories: ExistingMemoryContext[]
): RawConceptFromAI[] {
  const maxRelated = maxRelatedPerConcept();

  const emittedKeys = new Set(
    items
      .map((item) => normalizeKey(String(item.label || "")))
      .filter((key) => key.length > 0)
  );

  const existingKeys = new Set(
    existingMemories
      .map((memory) => normalizeKey(String(memory.label || "")))
      .filter((key) => key.length > 0)
  );

  const allowed = new Set<string>([...emittedKeys, ...existingKeys]);

  return items.map((item) => {
    const sourceKey = normalizeKey(String(item.label || ""));

    let input: unknown[] = [];

    if (Array.isArray(item.related)) {
      input = item.related;
    } else if (typeof item.related === "string") {
      input = item.related.split(",");
    }

    const cleaned: string[] = [];
    const seen = new Set<string>();

    for (const value of input) {
      if (typeof value !== "string") continue;

      const label = value
        .trim()
        .replace(/^["']+|["']+$/g, "")
        .replace(/\s+/g, " ");

      if (label.length < 2 || label.length > 120) continue;

      const key = normalizeKey(label);

      if (!key || key === sourceKey) continue;
      if (!allowed.has(key)) continue;
      if (seen.has(key)) continue;

      seen.add(key);
      cleaned.push(label);

      if (cleaned.length >= maxRelated) break;
    }

    return {
      ...item,
      related: cleaned,
    };
  });
}

async function extractOneSection(
  section: DocumentSection,
  domain: string,
  fieldType: string,
  filename: string | undefined,
  aiClient: AIClient,
  existingMemories: ExistingMemoryContext[],
  maxConcepts?: number
): Promise<SectionResult> {
  const prompt = buildDocumentExtractionPrompt({
    text: section.text,
    domain,
    fieldType,
    filename,
    heading: section.heading,
    existingMemories,
    maxConcepts,
  });

  const aiStart = Date.now();

  try {
    const response = await callAI(aiClient, prompt.systemPrompt, prompt.userPrompt);

    const aiTimeMs = Date.now() - aiStart;
    const parseStart = Date.now();

    const concepts = filterStructuralSections(
      parseConceptsFromResponse(response)
    );

    const parseTimeMs = Date.now() - parseStart;

    return { concepts, aiTimeMs, parseTimeMs };
  } catch (error) {
    return {
      concepts: [],
      aiTimeMs: Date.now() - aiStart,
      parseTimeMs: 0,
      error: (error as Error).message,
    };
  }
}

export async function processDocumentExtraction(
  text: string,
  domain: string,
  fieldType: string,
  aiClient: AIClient,
  filename?: string,
  options?: DocumentExtractionOptions
): Promise<SmartExtractionResult> {
  const totalStart = Date.now();

  const existingMemories = options?.existingMemories ?? [];
  const existingMemoriesProvided = existingMemories.length;
  const warnings: string[] = [];

  if (!text || text.trim().length < 50) {
    if (config.ai.strictMode) {
      throw new AIError("Document text is too short for extraction", {
        code: "EXTRACTION_TEXT_TOO_SHORT",
        task: "extraction",
        retryable: false,
      });
    }

    return {
      concepts: [],
      totalTimeMs: Date.now() - totalStart,
      aiTimeMs: 0,
      parseTimeMs: 0,
      conceptCount: 0,
      warnings: ["Document text is too short for extraction"],
      sectionCount: 0,
      aiCalls: 0,
      rawConceptCount: 0,
      acceptedConceptCount: 0,
      existingMemoriesProvided,
    };
  }

  const sections = splitDocumentIntoSections(text);

  if (sections.length > maxSections()) {
    warnings.push(
      `Document split into ${sections.length} sections; maximum target is ${maxSections()}`
    );
  }

  const sectionResults = await runWithConcurrency(
    sections,
    sectionConcurrency(),
    (section) =>
      extractOneSection(
        section,
        domain,
        fieldType,
        filename,
        aiClient,
        existingMemories,
        options?.maxConcepts
      )
  );

  let aiTimeMs = 0;
  let parseTimeMs = 0;
  const mergedRaw: RawConceptFromAI[] = [];

  for (const result of sectionResults) {
    aiTimeMs += result.aiTimeMs;
    parseTimeMs += result.parseTimeMs;

    if (result.error) {
      warnings.push(result.error);
    }

    for (const concept of result.concepts) {
      mergedRaw.push(concept);
    }
  }

  const rawConceptCount = mergedRaw.length;

  const maxConcepts =
    options?.maxConcepts && options.maxConcepts > 0
      ? options.maxConcepts
      : config.extraction.maxConceptsPerDocument;

  let concepts = dedupeRawConcepts(filterStructuralSections(mergedRaw)).slice(
    0,
    maxConcepts
  );

  concepts = cleanRelatedInRaw(concepts, existingMemories);

  const acceptedConceptCount = concepts.length;

  const wordCount = wordCountOf(text);

  const required =
    wordCount < 500
      ? config.ai.minConceptsTiny
      : wordCount < config.ai.largeDocumentWords
      ? config.ai.minConceptsSmall
      : config.ai.minConceptsLarge;

  if (acceptedConceptCount === 0) {
    throw new AIError(
      warnings.length > 0
        ? `AI extraction failed to produce usable concepts: ${warnings[0]}`
        : "AI extraction produced zero usable concepts",
      {
        code: "EXTRACTION_ZERO_USABLE_CONCEPTS",
        task: "extraction",
        retryable: warnings.length > 0,
      }
    );
  }

  if (config.ai.strictMode && acceptedConceptCount < required) {
    throw new AIError(
      `AI extraction produced ${acceptedConceptCount} concepts, required ${required}`,
      {
        code: "EXTRACTION_INSUFFICIENT_CONCEPTS",
        task: "extraction",
        retryable: true,
      }
    );
  }

  if (acceptedConceptCount < required) {
    warnings.push(
      `AI extraction produced ${acceptedConceptCount} concepts, recommended minimum ${required}`
    );
  }

  if (rawConceptCount > acceptedConceptCount) {
    warnings.push(
      `${rawConceptCount - acceptedConceptCount} raw concepts were rejected, filtered, or deduplicated`
    );
  }

  const totalTimeMs = Date.now() - totalStart;

  logger.info("Document extraction complete", {
    domain,
    fieldType,
    textLength: text.length,
    sectionCount: sections.length,
    warningCount: warnings.length,
    conceptCount: acceptedConceptCount,
    rawConceptCount,
    requiredConcepts: required,
    existingMemoriesProvided,
    aiTimeMs,
    parseTimeMs,
    totalTimeMs,
  });

  return {
    concepts,
    totalTimeMs,
    aiTimeMs,
    parseTimeMs,
    conceptCount: acceptedConceptCount,
    warnings,
    sectionCount: sections.length,
    aiCalls: sectionResults.length,
    rawConceptCount,
    acceptedConceptCount,
    existingMemoriesProvided,
  };
}

export async function processConversationExtraction(
  messages: Array<{ role: string; content: string }>,
  aiClient: AIClient
): Promise<SmartExtractionResult> {
  const totalStart = Date.now();

  if (!messages || messages.length === 0) {
    return {
      concepts: [],
      totalTimeMs: Date.now() - totalStart,
      aiTimeMs: 0,
      parseTimeMs: 0,
      conceptCount: 0,
      warnings: [],
      sectionCount: 0,
      aiCalls: 0,
      rawConceptCount: 0,
      acceptedConceptCount: 0,
      existingMemoriesProvided: 0,
    };
  }

  const systemPrompt = buildConversationExtractionSystemPrompt();

  const formatted = messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const maxChars = 12000;

  const conversationText =
    formatted.length > maxChars
      ? formatted.substring(formatted.length - maxChars)
      : formatted;

  const aiStart = Date.now();

  try {
    const response = await callAI(
      aiClient,
      systemPrompt,
      `Conversation:\n${conversationText}`
    );

    const aiTimeMs = Date.now() - aiStart;
    const parseStart = Date.now();

    let concepts = filterStructuralSections(
      parseConceptsFromResponse(response)
    );

    concepts = cleanRelatedInRaw(concepts, []);

    const parseTimeMs = Date.now() - parseStart;

    return {
      concepts,
      totalTimeMs: Date.now() - totalStart,
      aiTimeMs,
      parseTimeMs,
      conceptCount: concepts.length,
      warnings: [],
      sectionCount: 1,
      aiCalls: 1,
      rawConceptCount: concepts.length,
      acceptedConceptCount: concepts.length,
      existingMemoriesProvided: 0,
    };
  } catch (error) {
    if (config.ai.strictMode) {
      throw new AIError(
        `Conversation extraction failed: ${(error as Error).message}`,
        {
          code: "CONVERSATION_EXTRACTION_FAILED",
          task: "extraction",
          retryable: true,
        }
      );
    }

    logger.warn("Conversation extraction failed", {
      error: (error as Error).message,
    });

    return {
      concepts: [],
      totalTimeMs: Date.now() - totalStart,
      aiTimeMs: Date.now() - aiStart,
      parseTimeMs: 0,
      conceptCount: 0,
      warnings: [(error as Error).message],
      sectionCount: 1,
      aiCalls: 1,
      rawConceptCount: 0,
      acceptedConceptCount: 0,
      existingMemoriesProvided: 0,
    };
  }
}

export async function processMessageExtraction(
  content: string,
  role: string,
  aiClient: AIClient
): Promise<SmartExtractionResult> {
  const totalStart = Date.now();

  if (!content || content.trim().length < 20) {
    return {
      concepts: [],
      totalTimeMs: Date.now() - totalStart,
      aiTimeMs: 0,
      parseTimeMs: 0,
      conceptCount: 0,
      warnings: [],
      sectionCount: 0,
      aiCalls: 0,
      rawConceptCount: 0,
      acceptedConceptCount: 0,
      existingMemoriesProvided: 0,
    };
  }

  const systemPrompt = buildSingleMessageExtractionSystemPrompt();

  const speaker = role === "user" ? "User" : "Assistant";
  const userPrompt = `${speaker}: ${content.substring(0, 3000)}`;

  const aiStart = Date.now();

  try {
    const response = await callAI(aiClient, systemPrompt, userPrompt);

    let concepts = parseConceptsFromResponse(response);

    concepts = cleanRelatedInRaw(concepts, []);

    return {
      concepts,
      totalTimeMs: Date.now() - totalStart,
      aiTimeMs: Date.now() - aiStart,
      parseTimeMs: 0,
      conceptCount: concepts.length,
      warnings: [],
      sectionCount: 1,
      aiCalls: 1,
      rawConceptCount: concepts.length,
      acceptedConceptCount: concepts.length,
      existingMemoriesProvided: 0,
    };
  } catch (error) {
    logger.debug("Message extraction failed, skipping", {
      role,
      error: (error as Error).message,
    });

    return {
      concepts: [],
      totalTimeMs: Date.now() - totalStart,
      aiTimeMs: Date.now() - aiStart,
      parseTimeMs: 0,
      conceptCount: 0,
      warnings: [(error as Error).message],
      sectionCount: 1,
      aiCalls: 1,
      rawConceptCount: 0,
      acceptedConceptCount: 0,
      existingMemoriesProvided: 0,
    };
  }
}