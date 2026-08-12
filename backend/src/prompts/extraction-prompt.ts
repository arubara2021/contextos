import config from "../config";

export interface ExistingMemoryPromptItem {
  label: string;
  definition?: string | null;
  conceptType?: string;
  importance?: number;
}

export interface DocumentExtractionPromptOptions {
  text: string;
  domain: string;
  fieldType: string;
  filename?: string;
  heading?: string | null;
  existingMemories?: ExistingMemoryPromptItem[];
  maxConcepts?: number;
}

const LABEL_QUALITY_RULES = [
  "LABEL QUALITY RULES (strict - violating these corrupts the memory graph):",
  "- A label MUST be a noun phrase: a thing, concept, name, system, method, metric, or category.",
  "- GOOD labels: \"Conditional Memory Module\", \"Sparse Retrieval\", \"Throughput Results\", \"Validation Loss\", \"Mixture-of-Experts\".",
  "- BAD labels: \"It retains and utilizes information\", \"Includes a decay engine for\", \"The system is used for\", \"Memory Management\", \"Overview\", \"Summary\".",
  "- A label MUST NOT be a sentence, clause, or sentence fragment.",
  "- A label MUST NOT begin with a pronoun or verb.",
  "- A label MUST NOT contain finite verbs like manages, retains, includes, provides, helps, is, uses, used.",
  "- A label MUST NOT end with dangling connectors like for, of, the, to, with, by, that, which.",
  "- A label MUST NOT contain sentence punctuation such as !, ?, ;, comma lists, or a period followed by a space.",
  "- The definition MUST add real information beyond restating the label.",
  "- If the definition only rephrases the label, DROP the concept.",
].join("\n");

const GROUNDING_RULES = [
  "GROUNDING RULES (strict):",
  "- Extract ONLY concepts explicitly present in the provided text.",
  "- Do NOT import outside knowledge, famous names, examples, or assumptions.",
  "- Every definition MUST be directly supported by the text.",
  "- Every significance MUST explain the role of the concept inside THIS document.",
  "- Do NOT emit generic textbook definitions unless the document explicitly teaches them.",
].join("\n");

const STRUCTURAL_FORBIDDEN_RULES = [
  "STRUCTURAL FORBIDDEN RULES (strict):",
  "- Do NOT emit document overviews, summaries, abstracts, introductions, conclusions, references, appendices, or table-of-contents concepts.",
  "- Forbidden labels include: Overview, Summary, Abstract, Introduction, Conclusion, Related Work, References, Bibliography, Appendix, Document Purpose, What This Covers.",
  "- If a section is structural, extract the substantive concepts inside it, not the section itself.",
].join("\n");

const RELATED_RULES = [
  "RELATED RULES (strict):",
  "- The related array MUST contain only labels that are either newly emitted in the same JSON output or exact existing user memory labels provided below.",
  "- Do NOT invent related labels.",
  "- Use at most 4 related labels per concept.",
  "- Prefer related labels that represent real dependency, composition, cause, replacement, or strong topical connection.",
].join("\n");

const SIGNIFICANCE_RULES = [
  "SIGNIFICANCE RULES (strict):",
  "- Significance MUST explain why this concept matters in THIS document.",
  "- Significance MUST NOT repeat the definition.",
  "- Significance MUST NOT be generic, such as \"This is important\" or \"This is useful\".",
  "- Good significance answers: what role does this play, what problem does it solve, what result does it produce, what decision does it support, or what depends on it?",
].join("\n");

const RESULTS_EXTRACTION_RULES = [
  "RESULTS AND METRICS RULES (strict):",
  "- If the text contains results, metrics, benchmarks, datasets, comparisons, ablations, throughput, latency, accuracy, loss, speedup, or evaluation outcomes, extract them as concepts.",
  "- Result concepts should usually have type \"fact\" and importance 8 or 9 when they are important findings.",
  "- Result labels MUST name the actual result or metric, for example \"Throughput Results\", \"Validation Loss Improvement\", \"MMLU Accuracy\", \"Tokens Per Second\", \"Ablation Performance Drop\".",
  "- Do NOT use generic labels like \"Results\" unless the document explicitly names a result object that way.",
  "- The definition MUST include the quantitative or qualitative outcome when present.",
].join("\n");

const CONTRIBUTION_RULES = [
  "MAIN CONTRIBUTION AND PROBLEM RULES (strict):",
  "- If the text states the main contribution, proposed system, proposed method, central thesis, or primary novelty, extract the actual named contribution as a high-importance concept.",
  "- If the text states the problem being solved, extract the actual named problem as type \"problem\" with high importance.",
  "- Do NOT label the main contribution as \"Main Contribution\". Use the specific name, for example \"LongStraw\", \"Engram Module\", \"Conditional Memory\", \"Sparse Retrieval Architecture\".",
].join("\n");

const DOMAIN_GUIDANCE: Record<string, string> = {
  "computer-science":
    "Focus on algorithms, systems, architectures, models, benchmarks, performance metrics, technical contributions, named systems, design patterns, and specific accuracy/latency/throughput numbers.",
  medicine:
    "Focus on treatments, diagnoses, clinical findings, drug names, patient outcomes, medical procedures, pathological mechanisms, sample sizes, and p-values.",
  law:
    "Focus on legal principles, case references, judicial rulings, statutory provisions, legal arguments, precedents, and regulatory frameworks.",
  business:
    "Focus on strategies, market analyses, business decisions, financial metrics, organizational structures, competitive dynamics, and operational improvements.",
  biology:
    "Focus on biological mechanisms, molecular pathways, organisms, experimental methods, genetic concepts, evolutionary principles, and cellular processes.",
  physics:
    "Focus on physical theories, mathematical formulations, experimental results, physical constants, fundamental laws, and model predictions.",
  chemistry:
    "Focus on chemical reactions, molecular structures, synthesis methods, material properties, analytical techniques, and thermodynamic principles.",
  mathematics:
    "Focus on theorems, proofs, mathematical structures, formulas, conjectures, computational methods, and formal definitions.",
  engineering:
    "Focus on designs, specifications, system requirements, failure modes, optimization techniques, performance trade-offs, and implementation details.",
  humanities:
    "Focus on arguments, interpretations, historical contexts, cultural analyses, philosophical positions, theoretical frameworks, and critical perspectives.",
  general:
    "Extract the most important and memorable concepts. Focus on what is unique, significant, or actionable.",
  other:
    "Extract the most important and memorable concepts from this document.",
};

const FIELD_TYPE_GUIDANCE: Record<string, string> = {
  "research-paper":
    "Prioritize: main contribution, problem statement, proposed method, architecture, experiments, benchmarks, datasets, results, comparisons, ablations, limitations, and future directions.",
  "study-material":
    "Prioritize: core concepts, definitions, principles, formulas, examples, and exam-relevant facts.",
  textbook:
    "Prioritize: core concepts being taught, formal definitions, key principles, important formulas, worked examples, and concept relationships.",
  book:
    "Prioritize: central thesis, key arguments, supporting evidence, practical recommendations, notable examples, and unique insights.",
  documentation:
    "Prioritize: system architecture, API capabilities, configuration options, usage patterns, integration points, and best practices.",
  code:
    "Prioritize: architectural patterns, key algorithms, important functions, design decisions, configuration options, and trade-offs.",
  notes:
    "Prioritize: key takeaways, decisions made, action items, open questions, and important references.",
  report:
    "Prioritize: main findings, data-driven conclusions, recommendations, methodology, key metrics, and identified risks.",
  article:
    "Prioritize: main argument or story, key evidence, notable claims, practical implications, and unique perspectives.",
  other:
    "Extract the most important and memorable concepts from this document.",
};

function wordCountOf(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function getDomainGuidance(domain: string): string {
  return DOMAIN_GUIDANCE[domain] || DOMAIN_GUIDANCE["general"];
}

function getFieldTypeGuidance(fieldType: string): string {
  return FIELD_TYPE_GUIDANCE[fieldType] || FIELD_TYPE_GUIDANCE["other"];
}

function formatExistingMemories(
  existingMemories?: ExistingMemoryPromptItem[]
): string[] {
  if (!existingMemories || existingMemories.length === 0) {
    return [];
  }

  const limit = Number(config.extraction.existingMemoryLimit) || 40;
  const lines: string[] = [];

  for (const memory of existingMemories.slice(0, limit)) {
    const label = String(memory.label || "").trim();

    if (!label) continue;

    const type = String(memory.conceptType || "fact").trim() || "fact";
    const definition = String(memory.definition || "").trim();

    if (definition.length > 0) {
      lines.push(`- ${label} [${type}]: ${definition.substring(0, 140)}`);
    } else {
      lines.push(`- ${label} [${type}]`);
    }
  }

  return lines;
}

function targetConceptCount(text: string, maxConcepts?: number): number {
  const words = wordCountOf(text);

  let target = Math.max(3, Math.min(12, Math.round(words / 350)));

  if (maxConcepts && maxConcepts > 0) {
    target = Math.min(target, maxConcepts);
  }

  return target;
}

export function buildDocumentExtractionPrompt(
  options: DocumentExtractionPromptOptions
): { systemPrompt: string; userPrompt: string } {
  const domain = options.domain || "general";
  const fieldType = options.fieldType || "other";
  const target = targetConceptCount(options.text, options.maxConcepts);
  const existingMemoryLines = formatExistingMemories(options.existingMemories);

  const systemPromptParts = [
    "You are a strict knowledge extraction system for a persistent AI memory engine.",
    "Read the provided document section and extract concepts a person would want to remember months from now.",
    "",
    `Domain: ${domain}`,
    `Document type: ${fieldType}`,
    "",
    getDomainGuidance(domain),
    "",
    getFieldTypeGuidance(fieldType),
    "",
    LABEL_QUALITY_RULES,
    "",
    GROUNDING_RULES,
    "",
    STRUCTURAL_FORBIDDEN_RULES,
    "",
    CONTRIBUTION_RULES,
    "",
    RESULTS_EXTRACTION_RULES,
    "",
    RELATED_RULES,
    "",
    SIGNIFICANCE_RULES,
    "",
    "For each concept provide a JSON object with:",
    '- "label": concise noun phrase, 2-5 words, title case',
    '- "definition": 1-2 sentences explaining what this concept means specifically in this document',
    '- "significance": 1-2 sentences explaining why this concept matters in this document',
    '- "type": one of "problem", "decision", "fact", "entity", "event", "preference", "code"',
    '- "importance": integer 1-10',
    '- "related": array of at most 4 labels that you also emit as separate objects or exact existing memory labels',
    "",
    `Aim for approximately ${target} concepts.`,
    "Prefer sharp, specific, high-signal concepts over many vague concepts.",
    "Output ONLY a valid JSON array. No markdown fences, no explanation.",
  ];

  if (existingMemoryLines.length > 0) {
    systemPromptParts.push("");
    systemPromptParts.push("EXISTING USER MEMORIES:");
    systemPromptParts.push(...existingMemoryLines);
    systemPromptParts.push("");
    systemPromptParts.push(
      "You may use exact existing memory labels in the related array. Do not invent related labels."
    );
  }

  const systemPrompt = systemPromptParts.join("\n");

  const cap = Math.max(
    2000,
    Math.floor((Number(config.extraction.sectionCharCap) || 8000) * 1.2)
  );

  const safeText =
    options.text.length > cap ? options.text.substring(0, cap) : options.text;

  const head = [
    `[Domain: ${domain}]`,
    `[Type: ${fieldType}]`,
    options.filename ? `[File: ${options.filename}]` : "",
    options.heading ? `[Section: ${options.heading}]` : "",
  ]
    .filter((s) => s.length > 0)
    .join(" ");

  return {
    systemPrompt,
    userPrompt: `${head}\n${safeText}`,
  };
}

export function buildConversationExtractionSystemPrompt(): string {
  return [
    "You are extracting knowledge from a conversation between a user and an AI assistant.",
    "Identify important topics, decisions, facts, and preferences that were discussed.",
    "",
    LABEL_QUALITY_RULES,
    "",
    GROUNDING_RULES,
    "",
    RELATED_RULES,
    "",
    SIGNIFICANCE_RULES,
    "",
    "For each concept provide a JSON object with:",
    '- "label": concise noun phrase, 2-5 words, title case',
    '- "definition": 1-2 sentences capturing what was discussed, decided, or learned',
    '- "significance": 1-2 sentences explaining why this matters in this conversation',
    '- "type": one of "problem", "decision", "fact", "entity", "event", "preference", "code"',
    '- "importance": integer 1-10',
    '- "related": array of at most 4 connected concept labels',
    "",
    "Extract 3-10 concepts depending on conversation depth.",
    "Output ONLY a valid JSON array.",
  ].join("\n");
}

export function buildSingleMessageExtractionSystemPrompt(): string {
  return [
    "Extract knowledge from this single message in a conversation.",
    "Only extract concepts that are genuinely important and worth remembering long-term.",
    "",
    LABEL_QUALITY_RULES,
    "",
    GROUNDING_RULES,
    "",
    RELATED_RULES,
    "",
    SIGNIFICANCE_RULES,
    "",
    "For each concept provide a JSON object with:",
    '- "label": concise noun phrase, 2-5 words, title case',
    '- "definition": 1 sentence about what this means in context',
    '- "significance": 1 sentence about why this matters',
    '- "type": one of "problem", "decision", "fact", "entity", "event", "preference", "code"',
    '- "importance": integer 1-10',
    '- "related": array of connected concept labels',
    "",
    "Extract 0-5 concepts. If nothing is worth remembering, output [].",
    "Output ONLY a valid JSON array.",
  ].join("\n");
}