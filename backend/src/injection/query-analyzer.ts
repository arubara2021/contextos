import logger from "../utils/logger";
import { parseJsonAny } from "../agent/ai-provider";
import type { QuerySpec } from "./retriever";

export type { QuerySpec };

const VALID_CONCEPT_TYPES = new Set([
  "problem",
  "decision",
  "fact",
  "entity",
  "event",
  "preference",
  "code",
]);

const INTENT_KEYWORDS: Record<string, string[]> = {
  recall: [
    "what",
    "remember",
    "recall",
    "did i",
    "what was",
    "what did",
    "told",
    "said",
    "mentioned",
  ],
  compare: [
    "compare",
    "versus",
    "vs",
    "difference",
    "better",
    "worse",
    "prefer",
    "which",
  ],
  build_on: [
    "based on",
    "building on",
    "extending",
    "next step",
    "continue",
    "follow up",
    "related to",
  ],
  verify: [
    "is it true",
    "confirm",
    "verify",
    "correct",
    "accurate",
    "actually",
    "really",
  ],
  explore: [
    "tell me about",
    "explain",
    "describe",
    "what is",
    "how does",
    "how do",
    "what are",
    "elaborate",
  ],
  summarize: [
    "summarize",
    "summary",
    "overview",
    "main points",
    "key takeaways",
    "tldr",
  ],
  debug: [
    "error",
    "bug",
    "issue",
    "problem",
    "broken",
    "fix",
    "wrong",
    "fail",
    "crash",
  ],
  explain: ["why", "how", "explain", "reason", "cause", "because"],
};

const CHITCHAT_PATTERNS: RegExp[] = [
  /^\s*(hi|hello|hey|howdy|yo|sup|hiya|greetings|hola|hey\s+there|hello\s+there)\s*[!.?,]*\s*$/i,
  /^\s*how\s+are\s+you\s*[?.!]*\s*$/i,
  /^\s*how\s+are\s+ya\s*[?.!]*\s*$/i,
  /^\s*how\s+are\s+things\s*[?.!]*\s*$/i,
  /^\s*how('?s| is) it going\s*[?.!]*\s*$/i,
  /^\s*how do you do\s*[?.!]*\s*$/i,
  /^\s*what'?s up\s*[?.!]*\s*$/i,
  /^\s*what'?s good\s*[?.!]*\s*$/i,
  /^\s*(good|great|lovely)\s+(morning|afternoon|evening|night)\s*[?.!]*\s*$/i,
  /^\s*(thanks|thank you|thanku|thx|ty|cheers|appreciate it|ta)\s*[!.?,]*\s*$/i,
  /^\s*(bye|goodbye|see ya|see you|later|ciao|take care)\s*[!.?,]*\s*$/i,
  /^\s*(who|what) are you\s*[?.!]*\s*$/i,
  /^\s*(ok|okay|k|cool|got it|gotcha|understood|nice|great|awesome|sweet|perfect|sure|yep|yeah|nope|no)\s*[!.?,]*\s*$/i,
];

const ABSTRACT_QUERY_PHRASES: string[] = [
  "main contribution",
  "main contributions",
  "primary contribution",
  "key contribution",
  "what problem does it solve",
  "what problem does this solve",
  "what problems does it solve",
  "what does it solve",
  "what are the results",
  "what results does it",
  "what were the results",
  "experimental results",
  "main idea",
  "main ideas",
  "main point",
  "main points",
  "main topic",
  "main topics",
  "key idea",
  "key ideas",
  "key finding",
  "key findings",
  "key takeaway",
  "key takeaways",
  "summary",
  "summarize",
  "overview",
  "what is this document about",
  "what is this paper about",
  "what is this file about",
  "what is this about",
  "what does this document cover",
  "what does this paper cover",
  "what does this file cover",
  "what does this cover",
  "purpose",
  "thesis",
  "argument",
  "conclusion",
  "conclusions",
  "most important",
  "important findings",
  "core idea",
  "core message",
  "big picture",
  "high level",
  "what matters",
  "what changed",
  "what did we discuss",
  "decisions made",
  "lesson",
  "lessons",
  "takeaway",
  "takeaways",
];

const ABSTRACT_EXPANSIONS: Record<string, string[]> = {
  "main contribution": [
    "significance",
    "contribution",
    "novel",
    "proposes",
    "introduces",
    "primary achievement",
    "presents",
    "argues",
    "thesis",
    "purpose",
  ],
  contribution: [
    "significance",
    "novel",
    "proposes",
    "introduces",
    "primary achievement",
    "presents",
    "argues",
  ],
  problem: ["issue", "challenge", "obstacle", "difficulty", "limitation", "solves", "addresses"],
  problems: ["issue", "challenge", "obstacle", "difficulty", "limitation"],
  solve: ["resolve", "address", "fix", "mitigate", "handle"],
  solves: ["resolve", "address", "fix", "mitigate", "handle"],
  results: [
    "findings",
    "outcomes",
    "evaluation",
    "metrics",
    "performance",
    "experimental results",
    "benchmark",
    "throughput",
    "accuracy",
    "latency",
  ],
  result: [
    "findings",
    "outcomes",
    "evaluation",
    "metrics",
    "performance",
    "experimental results",
    "benchmark",
    "throughput",
    "accuracy",
    "latency",
  ],
  findings: ["results", "outcomes", "evaluation", "metrics", "performance"],
  performance: [
    "benchmark",
    "metric",
    "throughput",
    "latency",
    "accuracy",
    "speed",
    "evaluation",
  ],
  "key finding": [
    "finding",
    "result",
    "discovery",
    "outcome",
    "significant",
    "evaluation",
  ],
  important: ["significance", "important", "critical", "key", "major"],
  "core idea": ["concept", "idea", "principle", "fundamental", "core"],
  "what is this about": [
    "overview",
    "purpose",
    "summary",
    "about",
    "main topic",
    "presents",
    "describes",
    "covers",
  ],
  "what does this document cover": [
    "overview",
    "covers",
    "topics",
    "sections",
    "summary",
    "scope",
  ],
  "how it works": [
    "mechanism",
    "process",
    "method",
    "approach",
    "architecture",
  ],
  architecture: [
    "design",
    "structure",
    "component",
    "system",
    "infrastructure",
  ],
  "what did we discuss": [
    "conversation",
    "discussion",
    "talked about",
    "discussed",
  ],
  "decisions made": ["decision", "chose", "selected", "decided", "agreed"],
  summary: [
    "overview",
    "recap",
    "synthesis",
    "condensed",
    "presents",
    "main points",
  ],
  takeaways: ["takeaway", "lesson", "insight", "conclusion", "learning"],
  lesson: ["lesson", "teaches", "principle", "rule", "concept", "takeaway"],
  thesis: ["thesis", "argument", "claim", "position", "stance", "presents"],
  document: ["document", "paper", "file", "text", "section", "source"],
  "what problem does it solve": [
    "issue",
    "challenge",
    "gap",
    "limitation",
    "solves",
    "addresses",
  ],
  "what results does it report": [
    "findings",
    "outcomes",
    "evaluation",
    "metrics",
    "performance",
    "benchmark",
    "throughput",
    "accuracy",
  ],
};

const BROAD_QUERY_PATTERNS: RegExp[] = [
  /^(what|tell me|explain|describe|summarize)\s/i,
  /^(what is|what are|what was)\s+(this|that|the)\s+(about|document|paper|text|book|file|report|article)/i,
  /\b(main|key|important|core|primary)\s+(contribution|finding|idea|point|concept|topic|lesson|takeaway|result|results)\b/i,
  /\b(overview|summary|tldr|recap)\b/i,
  /^(how does|how do|how did)\s/i,
  /\bwhat\s+(problem|issue|challenge)\b/i,
  /\bwhat\s+(results|findings|outcomes)\b/i,
];

const DOCUMENT_SCOPED_PATTERNS: RegExp[] = [
  /\b(this|that|the current|the uploaded|the attached|the given)\s+(document|paper|file|pdf|text|article|report|book|section|page)\b/i,
  /\bin\s+this\s+(document|paper|file|pdf|text|article|report|book|section|page)\b/i,
  /\bfrom\s+the\s+(document|paper|file|pdf|text|article|report|book)\b/i,
  /\baccording\s+to\s+the\s+(document|paper|file|text|article|report|book)\b/i,
  /\bdocument\s+scoped\b/i,
  /\bwithin\s+the\s+(document|paper|file|text)\b/i,
  /\buploaded\s+(document|file|pdf)\b/i,
  /\bthis\s+(document|paper|file|pdf|text|article|report|book)\b/i,
  /\bthe\s+document\b/i,
  /\bthe\s+paper\b/i,
  /\bthe\s+file\b/i,
  /\bthe\s+pdf\b/i,
];

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "can",
  "shall",
  "must",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "from",
  "about",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "between",
  "under",
  "again",
  "further",
  "then",
  "once",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "it",
  "they",
  "them",
  "this",
  "that",
  "these",
  "those",
  "and",
  "but",
  "or",
  "nor",
  "not",
  "so",
  "yet",
  "if",
  "when",
  "where",
  "how",
  "what",
  "which",
  "who",
  "whom",
  "all",
  "each",
  "every",
  "both",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "no",
  "any",
  "only",
  "own",
  "same",
  "than",
  "too",
  "very",
  "just",
  "also",
  "now",
  "tell",
  "give",
  "show",
  "find",
  "get",
  "make",
  "let",
]);

function isChitchatQuery(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 48) return false;
  return CHITCHAT_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function extractKeyTerms(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const terms: string[] = [];
  const seen = new Set<string>();

  for (const word of words) {
    if (!seen.has(word)) {
      seen.add(word);
      terms.push(word);
    }
  }

  const bigrams: string[] = [];

  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]} ${words[i + 1]}`;

    if (!seen.has(bigram)) {
      seen.add(bigram);
      bigrams.push(bigram);
    }
  }

  return [...terms, ...bigrams].slice(0, 10);
}

function sanitizeExpandedTerms(terms: unknown[], limit: number): string[] {
  if (!Array.isArray(terms)) return [];

  const cleaned = new Set<string>();

  for (const term of terms) {
    if (typeof term !== "string") continue;

    const value = term
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!value || value.length < 3) continue;

    const words = value.split(" ");

    if (words.length === 1 && STOPWORDS.has(value)) continue;

    cleaned.add(value);

    if (cleaned.size >= limit) break;
  }

  return Array.from(cleaned);
}

function expandAbstractTerms(text: string): string[] {
  const lower = text.toLowerCase();
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (const [pattern, expansions] of Object.entries(ABSTRACT_EXPANSIONS)) {
    if (lower.includes(pattern.toLowerCase())) {
      for (const term of expansions) {
        if (!seen.has(term)) {
          seen.add(term);
          expanded.push(term);
        }
      }
    }
  }

  return expanded;
}

function buildExpandedTerms(text: string, keyTerms: string[]): string[] {
  const expanded = new Set<string>();

  for (const term of expandAbstractTerms(text)) {
    expanded.add(term);
  }

  for (const term of keyTerms) {
    const lower = term.toLowerCase().trim();

    if (!lower || lower.includes(" ")) continue;
    if (lower.length < 4) continue;

    if (lower.endsWith("s")) {
      expanded.add(lower.slice(0, -1));
    } else {
      expanded.add(`${lower}s`);
    }

    if (lower.endsWith("ing")) {
      expanded.add(lower.slice(0, -3));
    }

    if (lower.endsWith("ed")) {
      expanded.add(lower.slice(0, -2));
    }
  }

  return sanitizeExpandedTerms(Array.from(expanded), 8);
}

function detectIntent(text: string): string {
  const lower = text.toLowerCase().trim();

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.startsWith(keyword) || lower.includes(` ${keyword} `)) {
        return intent;
      }
    }
  }

  if (lower.endsWith("?")) return "explore";

  return "recall";
}

function computeSpecificity(text: string): number {
  const words = text.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  const meaningful = words.filter((w) => !STOPWORDS.has(w));
  const meaningfulRatio = words.length > 0 ? meaningful.length / words.length : 0;

  let specificity = meaningfulRatio;

  const properNouns = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g) || [];
  specificity += properNouns.length * 0.1;

  if (/"[^"]+"|'[^']+'/.test(text)) specificity += 0.15;

  if (/\b\d+(?:\.\d+)?%?\b/.test(text)) specificity += 0.1;

  for (const pattern of BROAD_QUERY_PATTERNS) {
    if (pattern.test(text)) {
      specificity -= 0.2;
      break;
    }
  }

  return Math.max(0, Math.min(1, specificity));
}

function sanitizePreferredTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const result = new Set<string>();

  for (const item of value) {
    if (typeof item !== "string") continue;

    const normalized = item.toLowerCase().trim();

    if (VALID_CONCEPT_TYPES.has(normalized)) {
      result.add(normalized);
    }

    if (result.size >= 4) break;
  }

  return Array.from(result);
}

function detectPreferredTypes(text: string, intent: string): string[] {
  const lower = text.toLowerCase();
  const types: string[] = [];

  if (/\b(error|bug|issue|problem|fail|crash|broken)\b/.test(lower)) {
    types.push("problem");
  }

  if (/\b(decision|chose|decided|selected|prefer|switch|migrate)\b/.test(lower)) {
    types.push("decision");
  }

  if (/\b(fact|data|metric|number|stat|measurement)\b/.test(lower)) {
    types.push("fact");
  }

  if (/\b(who|person|company|organization|tool|library|framework)\b/.test(lower)) {
    types.push("entity");
  }

  if (/\b(when|event|happened|occurred|timeline)\b/.test(lower)) {
    types.push("event");
  }

  if (/\b(prefer|like|dislike|opinion|taste)\b/.test(lower)) {
    types.push("preference");
  }

  if (/\b(code|function|api|endpoint|implementation|class|module)\b/.test(lower)) {
    types.push("code");
  }

  if (types.length === 0) {
    switch (intent) {
      case "debug":
        types.push("problem", "code");
        break;
      case "compare":
        types.push("decision", "fact");
        break;
      case "verify":
        types.push("fact", "decision");
        break;
      case "build_on":
        types.push("decision", "code", "fact");
        break;
      default:
        types.push("fact", "entity", "decision");
        break;
    }
  }

  return sanitizePreferredTypes(types);
}

function detectIsAbstract(text: string): boolean {
  const lower = text.toLowerCase();

  for (const phrase of ABSTRACT_QUERY_PHRASES) {
    if (lower.includes(phrase)) return true;
  }

  for (const pattern of BROAD_QUERY_PATTERNS) {
    if (pattern.test(text)) return true;
  }

  if (expandAbstractTerms(text).length > 0) return true;

  return false;
}

function detectDocumentScoped(text: string): boolean {
  return DOCUMENT_SCOPED_PATTERNS.some((pattern) => pattern.test(text));
}

export class QueryAnalyzer {
  private readonly aiClient?: {
    sendMessage(systemPrompt: string, userMessage: string): Promise<string>;
    generateStructured?: <T>(message: string, systemPrompt: string) => Promise<T>;
  };

  constructor(aiClient?: {
    sendMessage(systemPrompt: string, userMessage: string): Promise<string>;
    generateStructured?: <T>(message: string, systemPrompt: string) => Promise<T>;
  }) {
    this.aiClient = aiClient;
  }

  async analyze(queryText: string): Promise<QuerySpec> {
    const start = Date.now();

    const chitchat = isChitchatQuery(queryText);
    const keyTerms = chitchat ? [] : extractKeyTerms(queryText);
    const expandedTerms = chitchat ? [] : buildExpandedTerms(queryText, keyTerms);
    const intent = chitchat ? "chitchat" : detectIntent(queryText);
    const isAbstractQuery = chitchat ? false : detectIsAbstract(queryText);
    const documentScoped = chitchat ? false : detectDocumentScoped(queryText);

    let specificity = chitchat ? 0 : computeSpecificity(queryText);

    if ((isAbstractQuery || documentScoped) && specificity > 0.45) {
      specificity = 0.45;
    }

    const preferredTypes = chitchat ? [] : detectPreferredTypes(queryText, intent);

    let domain = "general";

    if (!chitchat) {
      try {
        domain = this.detectDomain(queryText);
      } catch {}
    }

    const result: QuerySpec = {
      keyTerms,
      expandedTerms,
      intent,
      domain,
      specificity,
      preferredTypes,
      isAbstractQuery,
      documentScoped,
      isChitchat: chitchat,
    };

    logger.debug("Query analysis complete", {
      query: queryText.substring(0, 100),
      keyTerms: keyTerms.length,
      expandedTerms: expandedTerms.length,
      intent,
      specificity: Math.round(specificity * 100) / 100,
      isAbstractQuery,
      documentScoped,
      isChitchat: chitchat,
      preferredTypes,
      durationMs: Date.now() - start,
    });

    return result;
  }

  async analyzeWithAI(queryText: string): Promise<QuerySpec> {
    const heuristic = await this.analyze(queryText);

    if (heuristic.isChitchat) {
      return heuristic;
    }

    if (!this.aiClient) {
      return heuristic;
    }

    try {
      const systemPrompt = [
        "You are a query analyzer. Given a user query, output a JSON object with:",
        '- "keyTerms": array of 3-8 important terms extracted from the query',
        '- "intent": one of "recall", "compare", "build_on", "verify", "explore", "summarize", "debug", "explain"',
        '- "domain": general domain or field',
        '- "specificity": number 0-1',
        '- "preferredTypes": array of memory types, only allowed values are problem, decision, fact, entity, event, preference, code',
        '- "expandedTerms": array of 2-8 synonyms or related terms',
        '- "documentScoped": boolean true only if the query explicitly refers to the current document, paper, file, or uploaded text',
        "Output ONLY valid JSON. No markdown, no explanation.",
      ].join("\n");

      let parsed: any;

      if (typeof this.aiClient.generateStructured === "function") {
        parsed = await this.aiClient.generateStructured(queryText, systemPrompt);
      } else {
        const response = await this.aiClient.sendMessage(systemPrompt, queryText);
        parsed = parseJsonAny(response);
      }

      const validIntents = new Set([
        "recall",
        "compare",
        "build_on",
        "verify",
        "explore",
        "summarize",
        "debug",
        "explain",
      ]);

      const aiPreferredTypes = sanitizePreferredTypes(parsed.preferredTypes);

      const aiExpandedTerms = sanitizeExpandedTerms(
        Array.isArray(parsed.expandedTerms)
          ? [...parsed.expandedTerms, ...heuristic.expandedTerms]
          : heuristic.expandedTerms,
        8
      );

      const aiKeyTerms = sanitizeExpandedTerms(
        Array.isArray(parsed.keyTerms)
          ? [...parsed.keyTerms, ...heuristic.keyTerms]
          : heuristic.keyTerms,
        12
      );

      let specificity =
        typeof parsed.specificity === "number"
          ? Math.max(0, Math.min(1, parsed.specificity))
          : heuristic.specificity;

      const isAbstractQuery =
        heuristic.isAbstractQuery || Boolean(parsed.isAbstractQuery);

      if (isAbstractQuery && specificity > 0.45) {
        specificity = 0.45;
      }

      const documentScoped =
        typeof parsed.documentScoped === "boolean"
          ? parsed.documentScoped || heuristic.documentScoped
          : heuristic.documentScoped;

      return {
        keyTerms: aiKeyTerms.length > 0 ? aiKeyTerms : heuristic.keyTerms,
        expandedTerms:
          aiExpandedTerms.length > 0 ? aiExpandedTerms : heuristic.expandedTerms,
        intent:
          typeof parsed.intent === "string" && validIntents.has(parsed.intent)
            ? parsed.intent
            : heuristic.intent,
        domain:
          typeof parsed.domain === "string" && parsed.domain.trim().length > 0
            ? parsed.domain
            : heuristic.domain,
        specificity,
        preferredTypes:
          aiPreferredTypes.length > 0
            ? aiPreferredTypes
            : heuristic.preferredTypes,
        isAbstractQuery,
        documentScoped,
        isChitchat: false,
      };
    } catch (error) {
      logger.debug("AI query analysis failed, using heuristic", {
        error: (error as Error).message,
      });

      return heuristic;
    }
  }

  private detectDomain(text: string): string {
    const lower = text.toLowerCase();

    const domainKeywords: Record<string, string[]> = {
      "computer-science": [
        "code",
        "api",
        "algorithm",
        "database",
        "function",
        "class",
        "bug",
        "deploy",
        "server",
        "typescript",
        "python",
        "react",
        "node",
      ],
      medicine: [
        "patient",
        "symptom",
        "treatment",
        "diagnosis",
        "drug",
        "clinical",
        "therapy",
        "medical",
      ],
      law: [
        "legal",
        "contract",
        "statute",
        "court",
        "liability",
        "regulation",
        "law",
      ],
      business: [
        "revenue",
        "market",
        "strategy",
        "customer",
        "profit",
        "roi",
        "kpi",
        "competitor",
        "money",
        "investing",
        "financial",
        "income",
        "wealth",
        "tax",
      ],
      biology: [
        "gene",
        "protein",
        "cell",
        "organism",
        "evolution",
        "dna",
        "enzyme",
      ],
      physics: [
        "quantum",
        "particle",
        "energy",
        "force",
        "gravity",
        "wave",
        "field",
      ],
      chemistry: [
        "molecule",
        "reaction",
        "compound",
        "element",
        "bond",
        "catalyst",
      ],
      mathematics: [
        "theorem",
        "proof",
        "equation",
        "formula",
        "integral",
        "matrix",
      ],
      engineering: [
        "design",
        "specification",
        "circuit",
        "structural",
        "tolerance",
        "prototype",
      ],
      humanities: [
        "history",
        "culture",
        "philosophy",
        "literature",
        "society",
        "art",
      ],
    };

    let bestDomain = "general";
    let bestScore = 0;

    for (const [domain, keywords] of Object.entries(domainKeywords)) {
      let score = 0;

      for (const keyword of keywords) {
        if (lower.includes(keyword)) score++;
      }

      if (score > bestScore) {
        bestScore = score;
        bestDomain = domain;
      }
    }

    return bestScore >= 2 ? bestDomain : "general";
  }
}

let analyzerInstance: QueryAnalyzer | null = null;

export function getQueryAnalyzer(aiClient?: {
  sendMessage(systemPrompt: string, userMessage: string): Promise<string>;
  generateStructured?: <T>(message: string, systemPrompt: string) => Promise<T>;
}): QueryAnalyzer {
  if (!analyzerInstance) {
    analyzerInstance = new QueryAnalyzer(aiClient);
  }

  return analyzerInstance;
}