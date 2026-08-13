import { createHash } from "crypto";
import type { Concept } from "../models/concept.model";
import { createConceptFromRaw, conceptToText } from "../models/concept.model";
import type { RawConceptFromAI } from "../agent/bedrock-client";
import type {
  IngestionResultPayload,
  DocumentIngestionResultPayload,
  FastIngestionResult,
  MetadataGateResult,
  PreparedChunk,
} from "../types/ingestion.types";
import { TextNormalizer } from "./normalizer";
import { ConceptExtractor, isLowQualityConcept } from "./extractor";
import { RelationshipMapper } from "./relationship-mapper";
import { EmbeddingGenerator } from "./embedding-generator";
import {
  processDocumentExtraction,
  processMessageExtraction,
  type AIClient,
} from "./smart-processor";
import { query, queryOne } from "../database";
import config from "../config";
import logger from "../utils/logger";

export interface RawStoreWriter {
  storeMessage(
    sessionId: string,
    role: string,
    content: string,
    timestamp: string
  ): Promise<string>;
  storeChunk(
    messageId: string,
    text: string,
    metadata: Record<string, unknown>
  ): Promise<void>;
  storeDocument(
    filename: string,
    fileType: string,
    content: string
  ): Promise<string>;
}

export interface BucketStoreWriter {
  getOrCreateBucket(
    label: string,
    definition: string,
    conceptType: string,
    importance: number,
    source: string,
    documentId?: string | null,
    userId?: string | null
  ): Promise<{ bucketId: string; isNew: boolean; exactMerge?: boolean }>;
  getExistingMemoryContext?(
    userId: string,
    limit?: number
  ): Promise<any[]>;
}

export interface EmbeddingStoreWriter {
  storeEmbedding(
    bucketId: string,
    vector: number[],
    documentId?: string | null
  ): Promise<void>;
}

type DocumentResultWithErrors = DocumentIngestionResultPayload & {
  errors?: string[];
};

type IngestionResultWithErrors = IngestionResultPayload & {
  errors?: string[];
};

interface QueuedTask {
  (): Promise<void>;
}

interface ConnectionStatsLocal {
  exactMerges: number;
  semanticConnections: number;
  crossDocumentConnections: number;
  strongConnections: number;
  connectionScore: number;
}

interface RelatedDocumentLocal {
  documentId: string;
  filename: string;
  correlation: number;
  sharedConcepts: number;
  edges: number;
  avgConfidence?: number;
}

interface TopConnectedMemoryLocal {
  bucketId: string;
  label: string;
  relationType: string;
  confidence: number;
  documentId: string | null;
}

interface CorrelationOutcome {
  connections: ConnectionStatsLocal;
  relatedDocuments: RelatedDocumentLocal[];
  topConnectedMemories: TopConnectedMemoryLocal[];
  edgesStored: number;
}

interface DocumentResultWithConnections extends DocumentResultWithErrors {
  connections?: ConnectionStatsLocal;
  relatedDocuments?: RelatedDocumentLocal[];
  topConnectedMemories?: TopConnectedMemoryLocal[];
  extraction?: {
    warnings: string[];
    sectionCount: number;
    aiCalls: number;
    rawConceptCount: number;
    acceptedConceptCount: number;
    existingMemoriesProvided: number;
  };
}

interface FastIngestionResultWithConnections extends FastIngestionResult {
  connections?: ConnectionStatsLocal;
  relatedDocuments?: RelatedDocumentLocal[];
  topConnectedMemories?: TopConnectedMemoryLocal[];
  extraction?: {
    warnings: string[];
    sectionCount: number;
    aiCalls: number;
    rawConceptCount: number;
    acceptedConceptCount: number;
    existingMemoriesProvided: number;
  };
}

type StoreConceptResult =
  | {
    ok: true;
    bucketId: string;
    isNew: boolean;
    exactMerge: boolean;
  }
  | {
    ok: false;
    label: string;
    error: string;
  };

const ingestionQueue: QueuedTask[] = [];
let isProcessing = false;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

function enqueueIngestion(task: QueuedTask): void {
  ingestionQueue.push(task);
  if (!isProcessing) {
    processQueue();
  }
}

async function processQueue(): Promise<void> {
  isProcessing = true;
  while (ingestionQueue.length > 0) {
    const task = ingestionQueue.shift();
    if (task) {
      try {
        await task();
      } catch (error) {
        logger.error("Background ingestion task failed", {
          error: (error as Error).message,
        });
      }
    }
  }
  isProcessing = false;
}

function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function emptyConnectionStats(): ConnectionStatsLocal {
  return {
    exactMerges: 0,
    semanticConnections: 0,
    crossDocumentConnections: 0,
    strongConnections: 0,
    connectionScore: 0,
  };
}

function emptyCorrelationOutcome(): CorrelationOutcome {
  return {
    connections: emptyConnectionStats(),
    relatedDocuments: [],
    topConnectedMemories: [],
    edgesStored: 0,
  };
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

const DOMAIN_PATTERNS: Array<{ domain: string; patterns: RegExp[] }> = [
  {
    domain: "computer-science",
    patterns: [
      /neural\s*network|machine\s*learning|deep\s*learning|transformer|gradient\s*descen/i,
      /\b(?:algorithm|embedding|loss\s*function|batch\s*size|learning\s*rate|fine.?tun)\b/i,
      /\b(?:software|architecture|api|database|compiler|runtime|kernel)\b/i,
      /\b(?:neural|transformer|attention|encoder|decoder|tokenizer)\b/i,
    ],
  },
  {
    domain: "medicine",
    patterns: [
      /\b(?:patient|clinical|diagnosis|treatment|therapeutic|dosage|symptom)\b/i,
      /\b(?:patholog|disease|medical|surgery|pharmaceutical|vaccine)\b/i,
      /\b(?:epidemiolog|oncolog|cardiol|neurol|immunol)\b/i,
    ],
  },
  {
    domain: "business",
    patterns: [
      /\b(?:revenue|market\s*share|profit|loss|cash\s*flow|balance\s*sheet)\b/i,
      /\b(?:investor|shareholder|dividend|stock|portfolio|asset)\b/i,
      /\b(?:financial|investing|money|wealth|income|tax(?:es)?|corporation)\b/i,
      /\b(?:entrepreneur|business\s*model|startup|venture|capital)\b/i,
      /\b(?:marketing|brand|customer\s*acquisition|sales\s*funnel)\b/i,
      /\b(?:budget|debt|credit|savings|insurance|retirement|mortgage)\b/i,
      /\b(?:strategy|competitive|advantage|market\s*analysis)\b/i,
    ],
  },
  {
    domain: "humanities",
    patterns: [
      /\b(?:apartheid|segregation|civil\s*rights|racism|discrimination)\b/i,
      /\b(?:memoir|autobiography|biography|childhood|upbringing)\b/i,
      /\b(?:history|culture|philosophy|literature|society|civilization)\b/i,
      /\b(?:art|music|religion|ethics|aesthetic|sociology|anthropology)\b/i,
      /\b(?:colonial|indigenous|ethnic|tribe|tradition|heritage)\b/i,
    ],
  },
  {
    domain: "law",
    patterns: [
      /\b(?:court|legal|statute|contract|liability|jurisdiction|plaintiff)\b/i,
      /\b(?:defendant|verdict|appeal|precedent|regulation|compliance)\b/i,
    ],
  },
  {
    domain: "mathematics",
    patterns: [
      /\b(?:theorem|proof|lemma|conjecture|integral|derivative)\b/i,
      /\b(?:eigenvalue|matrix|polynomial|topology|algebra)\b/i,
    ],
  },
  {
    domain: "physics",
    patterns: [
      /\b(?:quantum|relativity|particle|gravitational|electromagnetic)\b/i,
      /\b(?:thermodynamic|photon|electron|nuclear|optics)\b/i,
    ],
  },
  {
    domain: "chemistry",
    patterns: [
      /\b(?:molecule|compound|reaction|synthesis|catalyst|polymer|bond)\b/i,
      /\b(?:chemical|reagent|solvent|concentration|molar)\b/i,
    ],
  },
  {
    domain: "biology",
    patterns: [
      /\b(?:cell|protein|gene|organism|evolution|enzyme|chromosome)\b/i,
      /\b(?:metabol|genetic|ecology|bacteria|virus|species)\b/i,
    ],
  },
  {
    domain: "engineering",
    patterns: [
      /\b(?:circuit|structural|mechanical|load\s*bearing|tolerance|specification)\b/i,
      /\b(?:prototype|fabrication|manufacturing|HVAC|aerospace)\b/i,
    ],
  },
];

function detectDomainFromContent(text: string, filename: string): string {
  const sample = text.toLowerCase().substring(0, 10000);
  const fn = filename.toLowerCase();
  const scores: Record<string, number> = {};
  for (const { domain, patterns } of DOMAIN_PATTERNS) {
    let score = 0;
    for (const pattern of patterns) {
      const matches = sample.match(new RegExp(pattern.source, "gi"));
      if (matches) {
        score += matches.length;
      }
    }
    if (score > 0) {
      scores[domain] = score;
    }
  }
  if (
    fn.includes("paper") ||
    fn.includes("arxiv") ||
    fn.includes("proceedings")
  ) {
    for (const domain of Object.keys(scores)) {
      scores[domain] = (scores[domain] || 0) + 2;
    }
  }
  let bestDomain = "general";
  let bestScore = 0;
  for (const [domain, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }
  return bestScore >= 2 ? bestDomain : "general";
}

const BOOK_SIGNALS: RegExp[] = [
  /\bchapter\s+\d/i,
  /\blesson\s+\d/i,
  /\bpart\s+(?:one|two|three|four|five|[IVX]+|\d)/i,
  /\bforeword\b/i,
  /\bpreface\b/i,
  /\btable\s+of\s+contents\b/i,
  /\babout\s+the\s+author\b/i,
  /\bdedication\b/i,
  /\backnowledgments?\b/i,
];

const TEXTBOOK_SIGNALS: RegExp[] = [
  /\breview\s+questions?\b/i,
  /\bexercises?\b/i,
  /\blearning\s+objectives?\b/i,
  /\bkey\s+terms?\b/i,
  /\bchapter\s+summary\b/i,
  /\bfurther\s+reading\b/i,
  /\bcase\s+study\s+\d/i,
  /\bfigure\s+\d/i,
  /\btable\s+\d+\.\d/i,
];

const NARRATIVE_SIGNALS: RegExp[] = [
  /\bI\s+(?:was|had|remember|recall|grew|lived|went|came|saw|felt|thought|knew|wanted|needed)\b/,
  /\bmy\s+(?:mother|father|family|childhood|life|home|school|friend)\b/i,
  /\bwe\s+(?:were|had|lived|grew|went|came)\b/,
  /\bwhen\s+I\s+was\s+(?:young|a\s+child|growing|born)\b/i,
  /\bshe\s+said\b/,
  /\bhe\s+told\s+me\b/,
  /\bI\s+remember\b/,
  /\bthose\s+were\s+the\s+days\b/,
];

function detectFieldTypeFromContent(text: string, filename: string): string {
  const lower = text.toLowerCase().substring(0, 8000);
  const fn = filename.toLowerCase();

  if (
    /\.(py|ts|js|java|go|rs|cpp|c|rb|php|swift|kt|scala|sh|bash)$/i.test(fn)
  ) {
    return "code";
  }

  if (fn.endsWith(".md") || fn.endsWith(".markdown")) {
    if (/^#\s+/m.test(text)) return "documentation";
    return "notes";
  }

  if (fn.endsWith(".txt")) {
    if (/^#\s+/m.test(text)) return "notes";
    return "other";
  }

  if (fn.endsWith(".pdf") || fn.endsWith(".docx")) {
    const isArxiv =
      /\d{4}\.\d{4,5}(v\d+)?/i.test(filename) || /arxiv/i.test(filename);
    const hasAbstract = /\babstract\b/i.test(lower);
    const hasReferences = /\b(?:references|bibliography)\b/i.test(lower);
    const hasPaperSections =
      /\b(introduction|method|methods|methodology|results|discussion|conclusion)\b/i.test(
        lower
      );

    if (isArxiv || (hasReferences && hasPaperSections) || (hasAbstract && hasReferences)) {
      return "research-paper";
    }

    const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;

    let textbookScore = 0;
    for (const signal of TEXTBOOK_SIGNALS) {
      if (signal.test(text)) textbookScore++;
    }
    if (textbookScore >= 3) return "textbook";

    let narrativeScore = 0;
    const narrativeSample = text.substring(0, 15000);
    for (const signal of NARRATIVE_SIGNALS) {
      if (signal.test(narrativeSample)) narrativeScore++;
    }

    let bookSignalCount = 0;
    for (const signal of BOOK_SIGNALS) {
      if (signal.test(text)) bookSignalCount++;
    }

    if (narrativeScore >= 3 || (narrativeScore >= 2 && bookSignalCount >= 2)) {
      return "book";
    }
    if (bookSignalCount >= 2 || (bookSignalCount >= 1 && wordCount > 10000)) {
      return "book";
    }
    if (/\bchapter\s+\d/i.test(lower) || /\bunit\s+\d/i.test(lower)) {
      if (textbookScore >= 1) return "textbook";
      return "book";
    }
    if (wordCount > 20000) {
      return "book";
    }
    return "report";
  }

  return "other";
}

export class IngestionPipeline {
  private readonly normalizer: TextNormalizer;
  private readonly extractor: ConceptExtractor;
  private readonly relationshipMapper: RelationshipMapper;
  private readonly embeddingGenerator: EmbeddingGenerator;
  private readonly rawStore: RawStoreWriter;
  private readonly bucketStore: BucketStoreWriter;
  private readonly embeddingStore: EmbeddingStoreWriter;
  private readonly aiClient: AIClient;

  constructor(deps: {
    normalizer: TextNormalizer;
    extractor: ConceptExtractor;
    relationshipMapper: RelationshipMapper;
    embeddingGenerator: EmbeddingGenerator;
    rawStore: RawStoreWriter;
    bucketStore: BucketStoreWriter;
    embeddingStore: EmbeddingStoreWriter;
    aiClient: AIClient;
  }) {
    this.normalizer = deps.normalizer;
    this.extractor = deps.extractor;
    this.relationshipMapper = deps.relationshipMapper;
    this.embeddingGenerator = deps.embeddingGenerator;
    this.rawStore = deps.rawStore;
    this.bucketStore = deps.bucketStore;
    this.embeddingStore = deps.embeddingStore;
    this.aiClient = deps.aiClient;
  }

  async ingestDocument(
    content: string,
    filename: string,
    fileType: string,
    existingDocumentId?: string,
    userId?: string | null
  ): Promise<DocumentIngestionResultPayload> {
    const start = Date.now();

    if (!content || content.trim().length < 10) {
      return this.emptyDocumentResult(
        "",
        filename,
        "empty",
        Date.now() - start,
        ["Document text is too short"]
      );
    }

    const cleaned = this.normalizer.cleanDocumentText(content, fileType);
    if (!cleaned || cleaned.trim().length < 10) {
      return this.emptyDocumentResult(
        "",
        filename,
        "empty",
        Date.now() - start,
        ["Document text could not be normalized"]
      );
    }

    const wordCount = cleaned.split(/\s+/).filter((w) => w.length > 0).length;
    const hash = hashContent(content);

    let resolvedUserId = userId ?? null;
    if (resolvedUserId && !isValidUuid(resolvedUserId)) {
      resolvedUserId = null;
    }
    if (!resolvedUserId && existingDocumentId) {
      resolvedUserId = await this.resolveUserId(existingDocumentId);
    }

    let documentId: string;

    if (existingDocumentId) {
      documentId = existingDocumentId;
      try {
        await query(
          "UPDATE documents SET content_hash = $1 WHERE document_id = $2 AND content_hash IS NULL",
          [hash, documentId]
        );
      } catch { }
    } else {
      try {
        const existing = resolvedUserId
          ? await queryOne<{ document_id: string }>(
            "SELECT document_id FROM documents WHERE user_id = $1 AND content_hash = $2 LIMIT 1",
            [resolvedUserId, hash]
          )
          : await queryOne<{ document_id: string }>(
            "SELECT document_id FROM documents WHERE content_hash = $1 LIMIT 1",
            [hash]
          );

        if (existing) {
          logger.info("Duplicate document skipped", {
            filename,
            existingDocumentId: existing.document_id,
            userId: resolvedUserId,
          });
          return this.emptyDocumentResult(
            existing.document_id,
            filename,
            "duplicate",
            Date.now() - start
          );
        }
      } catch { }

      try {
        documentId = await this.rawStore.storeDocument(
          filename,
          fileType,
          content
        );
      } catch (error) {
        logger.error("Failed to store document", {
          filename,
          error: (error as Error).message,
        });
        return this.emptyDocumentResult(
          "",
          filename,
          "failed",
          Date.now() - start,
          [(error as Error).message]
        );
      }

      try {
        await query(
          "UPDATE documents SET content_hash = $1 WHERE document_id = $2",
          [hash, documentId]
        );
      } catch { }

      if (resolvedUserId) {
        try {
          await query(
            "UPDATE documents SET user_id = $1 WHERE document_id = $2 AND user_id IS NULL",
            [resolvedUserId, documentId]
          );
        } catch { }
      }
    }

    if (!resolvedUserId) {
      resolvedUserId = await this.resolveUserId(documentId);
    }

    const domain = detectDomainFromContent(cleaned, filename);
    const fieldType = detectFieldTypeFromContent(cleaned, filename);

    logger.info("Document classified", {
      filename,
      domain,
      fieldType,
      wordCount,
      userId: resolvedUserId,
    });

    const existingMemories = await this.getExistingMemories(resolvedUserId);

    const aiErrors: string[] = [];
    let rawConcepts: RawConceptFromAI[] = [];
    let extractionTimeMs = 0;
    let extractionResult: any = null;

    try {
      extractionResult = await processDocumentExtraction(
        cleaned,
        domain,
        fieldType,
        this.aiClient,
        filename,
        {
          existingMemories,
          maxConcepts: config.extraction.maxConceptsPerDocument,
        }
      );
      rawConcepts = extractionResult.concepts;
      extractionTimeMs = extractionResult.totalTimeMs;
    } catch (error) {
      aiErrors.push((error as Error).message);
      logger.error("Document extraction failed", {
        filename,
        documentId,
        error: (error as Error).message,
      });
    }

    if (rawConcepts.length === 0) {
      return this.emptyDocumentResult(
        documentId,
        filename,
        "failed",
        Date.now() - start,
        aiErrors.length > 0
          ? aiErrors
          : ["AI extraction produced zero concepts"]
      );
    }

    const concepts = this.createConceptsFromRaw(rawConcepts, filename);
    const filtered = concepts.filter(
      (c) => c.importance >= config.extraction.minConceptImportance
    );

    const embedResult = await this.embedConceptsParallel(filtered);
    const withEmbeddings = embedResult.concepts.filter(
      (c) =>
        c.embedding &&
        this.embeddingGenerator.validateEmbedding(c.embedding)
    );

    const finalErrors = Array.from(
      new Set([...aiErrors, ...embedResult.errors])
    );

    if (withEmbeddings.length === 0) {
      return this.emptyDocumentResult(
        documentId,
        filename,
        "failed",
        Date.now() - start,
        finalErrors.length > 0
          ? finalErrors
          : ["No concepts could be embedded"]
      );
    }

    const required = this.requiredConceptCount(wordCount);
    if (config.ai.strictMode && withEmbeddings.length < required) {
      return this.emptyDocumentResult(
        documentId,
        filename,
        "failed",
        Date.now() - start,
        [
          ...finalErrors,
          `AI extraction produced ${withEmbeddings.length} usable concepts, required ${required}`,
        ]
      );
    }

    const storeResult = await this.storeConcepts(
      withEmbeddings,
      documentId,
      resolvedUserId
    );
    finalErrors.push(...storeResult.errors);

    let relationshipsMapped = 0;
    let correlation = emptyCorrelationOutcome();

    if (documentId && resolvedUserId) {
      const syncStored = await this.syncDocumentRelationships(
        resolvedUserId,
        documentId,
        withEmbeddings,
        rawConcepts,
        storeResult.bucketIdByLabel
      );

      correlation = await this.runCorrelation({
        userId: resolvedUserId,
        documentId,
        concepts: withEmbeddings,
        bucketIdByLabel: storeResult.bucketIdByLabel,
        mergedBucketIds: storeResult.mergedBucketIds,
      });

      relationshipsMapped = syncStored + correlation.edgesStored;
    }

    if (relationshipsMapped === 0 && !resolvedUserId) {
      try {
        const relationshipResult =
          await this.relationshipMapper.mapFromExtraction(
            rawConcepts,
            withEmbeddings
          );
        relationshipsMapped = relationshipResult.stored;
      } catch (error) {
        logger.error("Relationship mapping from extraction failed", {
          filename,
          error: (error as Error).message,
        });
      }

      if (relationshipsMapped === 0 && withEmbeddings.length > 1) {
        try {
          const discoveryResult =
            await this.relationshipMapper.discoverCrossDocument(
              withEmbeddings,
              this.embeddingStore as any
            );
          relationshipsMapped = discoveryResult.stored;
        } catch (error) {
          logger.error("Cross-document relationship discovery failed", {
            filename,
            error: (error as Error).message,
          });
        }
      }
    }

    const durationMs = Date.now() - start;

    logger.info("Document ingested", {
      filename,
      documentId,
      domain,
      fieldType,
      conceptsExtracted: withEmbeddings.length,
      requiredConcepts: required,
      newBuckets: storeResult.newBuckets,
      mergedBuckets: storeResult.mergedBuckets,
      exactMerges: storeResult.exactMerges,
      crossDocumentExactMerges: correlation.connections.exactMerges,
      relationshipsMapped,
      semanticConnections: correlation.connections.semanticConnections,
      crossDocumentConnections: correlation.connections.crossDocumentConnections,
      connectionScore: correlation.connections.connectionScore,
      extractionTimeMs,
      durationMs,
      userId: resolvedUserId,
      errorCount: finalErrors.length,
    });

    const payload: DocumentResultWithConnections = {
      documentId,
      filename,
      status: "complete",
      conceptsExtracted: withEmbeddings.length,
      newBuckets: storeResult.newBuckets,
      mergedBuckets: storeResult.mergedBuckets,
      relationshipsMapped,
      chunksProcessed: 1,
      chunksFailed: 0,
      durationMs,
      errors: finalErrors,
      connections: correlation.connections,
      relatedDocuments: correlation.relatedDocuments,
      topConnectedMemories: correlation.topConnectedMemories,
      extraction: this.buildExtractionMeta(extractionResult, rawConcepts),
    };

    return payload;
  }

  async ingestDocumentFast(params: {
    filename: string;
    fileType: string;
    chunks: PreparedChunk[];
    metadata: MetadataGateResult;
    sessionId: string;
    userId?: string | null;
  }): Promise<FastIngestionResult> {
    const start = Date.now();
    const errors: string[] = [];

    const fullText = params.chunks.map((c) => c.text).join("\n");
    const wordCount = fullText.split(/\s+/).filter((w) => w.length > 0).length;
    const domain = params.metadata.domain;
    const fieldType = params.metadata.fieldType;
    const hash = hashContent(fullText);

    let resolvedUserId = params.userId ?? null;
    if (resolvedUserId && !isValidUuid(resolvedUserId)) {
      resolvedUserId = null;
    }

    try {
      const existing = resolvedUserId
        ? await queryOne<{ document_id: string }>(
          "SELECT document_id FROM documents WHERE user_id = $1 AND content_hash = $2 LIMIT 1",
          [resolvedUserId, hash]
        )
        : await queryOne<{ document_id: string }>(
          "SELECT document_id FROM documents WHERE content_hash = $1 LIMIT 1",
          [hash]
        );

      if (existing) {
        logger.info("Duplicate document skipped (fast path)", {
          filename: params.filename,
          existingDocumentId: existing.document_id,
        });
        return {
          fileId: params.metadata.fileId,
          filename: params.filename,
          fieldType,
          domain,
          status: "duplicate",
          chunksCreated: 0,
          conceptsExtracted: 0,
          embeddingsGenerated: 0,
          newBuckets: 0,
          mergedBuckets: 0,
          durationMs: Date.now() - start,
          errors: [],
        };
      }
    } catch { }

    let documentId: string;
    try {
      documentId = await this.rawStore.storeDocument(
        params.filename,
        params.fileType,
        fullText
      );
    } catch (error) {
      logger.error("Fast path: failed to store document", {
        filename: params.filename,
        error: (error as Error).message,
      });
      return {
        fileId: params.metadata.fileId,
        filename: params.filename,
        fieldType,
        domain,
        status: "failed",
        chunksCreated: 0,
        conceptsExtracted: 0,
        embeddingsGenerated: 0,
        newBuckets: 0,
        mergedBuckets: 0,
        durationMs: Date.now() - start,
        errors: [(error as Error).message],
      };
    }

    try {
      await query(
        "UPDATE documents SET content_hash = $1 WHERE document_id = $2",
        [hash, documentId]
      );
    } catch { }

    if (resolvedUserId) {
      try {
        await query(
          "UPDATE documents SET user_id = $1 WHERE document_id = $2 AND user_id IS NULL",
          [resolvedUserId, documentId]
        );
      } catch { }
    }

    for (const chunk of params.chunks) {
      try {
        await this.rawStore.storeChunk(documentId, chunk.text, {
          section: chunk.section,
          chunkIndex: chunk.chunkIndex,
          tokenEstimate: chunk.tokenEstimate,
          fieldType: params.metadata.fieldType,
          domain: params.metadata.domain,
          strategy: params.metadata.strategy,
          fileId: params.metadata.fileId,
          ...chunk.metadata,
        });
      } catch { }
    }

    const existingMemories = await this.getExistingMemories(resolvedUserId);

    let rawConcepts: RawConceptFromAI[] = [];
    let extractionResult: any = null;

    try {
      extractionResult = await processDocumentExtraction(
        fullText,
        domain,
        fieldType,
        this.aiClient,
        params.filename,
        {
          existingMemories,
          maxConcepts: config.extraction.maxConceptsPerDocument,
        }
      );
      rawConcepts = extractionResult.concepts;
    } catch (error) {
      errors.push((error as Error).message);
      logger.error("Fast path: extraction failed", {
        filename: params.filename,
        error: (error as Error).message,
      });
    }

    if (rawConcepts.length === 0) {
      return {
        fileId: params.metadata.fileId,
        filename: params.filename,
        fieldType,
        domain,
        status: "failed",
        chunksCreated: params.chunks.length,
        conceptsExtracted: 0,
        embeddingsGenerated: 0,
        newBuckets: 0,
        mergedBuckets: 0,
        durationMs: Date.now() - start,
        errors:
          errors.length > 0
            ? errors
            : ["AI extraction produced zero concepts"],
      };
    }

    const concepts = this.createConceptsFromRaw(rawConcepts, params.filename);
    const filtered = concepts.filter(
      (c) => c.importance >= config.extraction.minConceptImportance
    );

    const embedResult = await this.embedConceptsParallel(filtered);
    const withEmbeddings = embedResult.concepts.filter(
      (c) =>
        c.embedding &&
        this.embeddingGenerator.validateEmbedding(c.embedding)
    );
    errors.push(...embedResult.errors);

    if (withEmbeddings.length === 0) {
      return {
        fileId: params.metadata.fileId,
        filename: params.filename,
        fieldType,
        domain,
        status: "failed",
        chunksCreated: params.chunks.length,
        conceptsExtracted: 0,
        embeddingsGenerated: 0,
        newBuckets: 0,
        mergedBuckets: 0,
        durationMs: Date.now() - start,
        errors:
          errors.length > 0 ? errors : ["No concepts could be embedded"],
      };
    }

    const required = this.requiredConceptCount(wordCount);
    if (config.ai.strictMode && withEmbeddings.length < required) {
      return {
        fileId: params.metadata.fileId,
        filename: params.filename,
        fieldType,
        domain,
        status: "failed",
        chunksCreated: params.chunks.length,
        conceptsExtracted: withEmbeddings.length,
        embeddingsGenerated: withEmbeddings.length,
        newBuckets: 0,
        mergedBuckets: 0,
        durationMs: Date.now() - start,
        errors: [
          ...errors,
          `AI extraction produced ${withEmbeddings.length} usable concepts, required ${required}`,
        ],
      };
    }

    const storeResult = await this.storeConcepts(
      withEmbeddings,
      documentId,
      resolvedUserId
    );
    errors.push(...storeResult.errors);

    let relationshipsMapped = 0;
    let correlation = emptyCorrelationOutcome();

    if (documentId && resolvedUserId) {
      const syncStored = await this.syncDocumentRelationships(
        resolvedUserId,
        documentId,
        withEmbeddings,
        rawConcepts,
        storeResult.bucketIdByLabel
      );

      correlation = await this.runCorrelation({
        userId: resolvedUserId,
        documentId,
        concepts: withEmbeddings,
        bucketIdByLabel: storeResult.bucketIdByLabel,
        mergedBucketIds: storeResult.mergedBucketIds,
      });

      relationshipsMapped = syncStored + correlation.edgesStored;
    }

    if (relationshipsMapped === 0 && !resolvedUserId) {
      try {
        const relationshipResult =
          await this.relationshipMapper.mapFromExtraction(
            rawConcepts,
            withEmbeddings
          );
        relationshipsMapped = relationshipResult.stored;
      } catch (error) {
        logger.error("Relationship mapping from extraction failed (fast path)", {
          filename: params.filename,
          error: (error as Error).message,
        });
      }
    }

    const durationMs = Date.now() - start;

    logger.info("Document ingested (fast path)", {
      filename: params.filename,
      fileId: params.metadata.fileId,
      fieldType,
      domain,
      chunks: params.chunks.length,
      conceptsExtracted: withEmbeddings.length,
      requiredConcepts: required,
      newBuckets: storeResult.newBuckets,
      mergedBuckets: storeResult.mergedBuckets,
      exactMerges: storeResult.exactMerges,
      crossDocumentExactMerges: correlation.connections.exactMerges,
      relationshipsMapped,
      semanticConnections: correlation.connections.semanticConnections,
      connectionScore: correlation.connections.connectionScore,
      durationMs,
      errorCount: errors.length,
    });

    const payload: FastIngestionResultWithConnections = {
      fileId: params.metadata.fileId,
      filename: params.filename,
      fieldType,
      domain,
      status: "complete",
      chunksCreated: params.chunks.length,
      conceptsExtracted: withEmbeddings.length,
      embeddingsGenerated: withEmbeddings.length,
      newBuckets: storeResult.newBuckets,
      mergedBuckets: storeResult.mergedBuckets,
      durationMs,
      errors,
      connections: correlation.connections,
      relatedDocuments: correlation.relatedDocuments,
      topConnectedMemories: correlation.topConnectedMemories,
      extraction: this.buildExtractionMeta(extractionResult, rawConcepts),
    };

    return payload;
  }

  async ingestMessage(
    role: string,
    content: string,
    source: string,
    sessionId: string,
    timestamp: string,
    existingMessageId?: string,
    userId?: string | null
  ): Promise<IngestionResultPayload> {
    const start = Date.now();

    if (!content || !content.trim()) {
      return this.emptyIngestionResult(Date.now() - start);
    }

    let messageId: string;
    if (existingMessageId) {
      messageId = existingMessageId;
    } else {
      try {
        messageId = await this.rawStore.storeMessage(
          sessionId,
          role,
          content,
          timestamp
        );
      } catch (error) {
        logger.error("Failed to store raw message", {
          sessionId,
          role,
          error: (error as Error).message,
        });
        return this.emptyIngestionResult(Date.now() - start, [
          (error as Error).message,
        ]);
      }
    }

    const chunks = this.normalizer.normalizeMessage(
      role,
      content,
      source,
      sessionId,
      timestamp
    );

    if (chunks.length > 0) {
      await Promise.all(
        chunks.map((chunk) =>
          this.rawStore
            .storeChunk(messageId, chunk.text, {
              role: chunk.role,
              source: chunk.source,
              sessionId: chunk.sessionId,
              timestamp: chunk.timestamp,
              chunkIndex: chunk.chunkIndex,
              tokenEstimate: chunk.tokenEstimate,
            })
            .catch(() => { })
        )
      );
    }

    let rawConcepts: RawConceptFromAI[] = [];
    try {
      const result = await processMessageExtraction(
        content,
        role,
        this.aiClient
      );
      rawConcepts = result.concepts;
    } catch (error) {
      logger.debug("Message extraction failed", {
        sessionId,
        role,
        error: (error as Error).message,
      });
    }

    const concepts = this.createConceptsFromRaw(rawConcepts, source);
    const embedResult = await this.embedConceptsParallel(concepts);
    const withEmbeddings = embedResult.concepts.filter(
      (c) =>
        c.embedding &&
        this.embeddingGenerator.validateEmbedding(c.embedding)
    );

    const safeUserId = userId && isValidUuid(userId) ? userId : null;

    const storeResult = await this.storeConcepts(
      withEmbeddings,
      undefined,
      safeUserId
    );

    let relationshipsMapped = 0;
    try {
      const relationshipResult = await this.relationshipMapper.mapFromExtraction(
        rawConcepts,
        withEmbeddings
      );
      relationshipsMapped = relationshipResult.stored;
    } catch (error) {
      logger.error("Relationship mapping from extraction failed", {
        sessionId,
        error: (error as Error).message,
      });
    }

    if (safeUserId && storeResult.bucketIdByLabel.size > 0) {
      try {
        await query(
          `UPDATE buckets
           SET user_id = $1
           WHERE bucket_id = ANY($2::uuid[]) AND user_id IS NULL`,
          [safeUserId, Array.from(storeResult.bucketIdByLabel.values())]
        );
      } catch { }
    }

    const durationMs = Date.now() - start;

    logger.info("Message ingested", {
      sessionId,
      role,
      conceptsExtracted: withEmbeddings.length,
      newBuckets: storeResult.newBuckets,
      mergedBuckets: storeResult.mergedBuckets,
      relationshipsMapped,
      durationMs,
      userId: safeUserId,
    });

    return this.emptyIngestionResult(durationMs, [
      ...embedResult.errors,
      ...storeResult.errors,
    ]);
  }

  ingestMessageAsync(
    role: string,
    content: string,
    source: string,
    sessionId: string,
    timestamp: string,
    existingMessageId?: string,
    userId?: string | null
  ): void {
    enqueueIngestion(async () => {
      try {
        await this.ingestMessage(
          role,
          content,
          source,
          sessionId,
          timestamp,
          existingMessageId,
          userId
        );
      } catch (error) {
        logger.error("Async message ingestion failed", {
          sessionId,
          error: (error as Error).message,
        });
      }
    });
    logger.debug("Message ingestion queued", { sessionId, role });
  }

  async ingestDocumentAsync(
    content: string,
    filename: string,
    fileType: string,
    userId?: string | null
  ): Promise<string> {
    const hash = hashContent(content);
    const safeUserId = userId && isValidUuid(userId) ? userId : null;

    try {
      const existing = safeUserId
        ? await queryOne<{ document_id: string }>(
          "SELECT document_id FROM documents WHERE user_id = $1 AND content_hash = $2 LIMIT 1",
          [safeUserId, hash]
        )
        : await queryOne<{ document_id: string }>(
          "SELECT document_id FROM documents WHERE content_hash = $1 LIMIT 1",
          [hash]
        );

      if (existing) {
        logger.info("Duplicate document skipped (async)", {
          filename,
          existingDocumentId: existing.document_id,
        });
        return existing.document_id;
      }
    } catch { }

    const documentId = await this.rawStore.storeDocument(
      filename,
      fileType,
      content
    );

    try {
      await query(
        "UPDATE documents SET content_hash = $1 WHERE document_id = $2",
        [hash, documentId]
      );
    } catch { }

    if (safeUserId) {
      try {
        await query(
          "UPDATE documents SET user_id = $1 WHERE document_id = $2 AND user_id IS NULL",
          [safeUserId, documentId]
        );
      } catch { }
    }

    enqueueIngestion(async () => {
      try {
        await this.ingestDocument(
          content,
          filename,
          fileType,
          documentId,
          safeUserId
        );
      } catch (error) {
        logger.error("Async document ingestion failed", {
          filename,
          error: (error as Error).message,
        });
      }
    });

    logger.info("Document ingestion queued", { filename, documentId });
    return documentId;
  }

  private async runCorrelation(params: {
    userId: string;
    documentId: string;
    concepts: Array<Concept & { embedding?: number[] | null }>;
    bucketIdByLabel: Map<string, string>;
    mergedBucketIds: string[];
  }): Promise<CorrelationOutcome> {
    if (!params.userId || !params.documentId) {
      return emptyCorrelationOutcome();
    }
    if (!isValidUuid(params.userId) || !isValidUuid(params.documentId)) {
      return emptyCorrelationOutcome();
    }

    try {
      const { getCorrelationEngine } = await import("./correlation-engine");
      const engine = getCorrelationEngine();

      const result = await engine.run({
        userId: params.userId,
        documentId: params.documentId,
        concepts: params.concepts.map((concept) => ({
          label: concept.label,
          embedding: concept.embedding ?? null,
        })),
        bucketIdByLabel: params.bucketIdByLabel,
        mergedBucketIds: params.mergedBucketIds,
      });

      return {
        connections: result.connections,
        relatedDocuments: result.relatedDocuments,
        topConnectedMemories: result.topConnectedMemories,
        edgesStored: result.edgesStored,
      };
    } catch (error) {
      logger.warn("Correlation engine pass failed", {
        userId: params.userId,
        documentId: params.documentId,
        error: (error as Error).message,
      });
      return emptyCorrelationOutcome();
    }
  }

  private async getExistingMemories(userId: string | null): Promise<any[]> {
    if (!userId || !isValidUuid(userId)) return [];
    const store = this.bucketStore as any;
    if (typeof store.getExistingMemoryContext !== "function") {
      return [];
    }
    try {
      const memories = await store.getExistingMemoryContext(
        userId,
        config.extraction.existingMemoryLimit
      );
      return Array.isArray(memories) ? memories : [];
    } catch {
      return [];
    }
  }

  private buildExtractionMeta(
    extractionResult: any,
    rawConcepts: RawConceptFromAI[]
  ): {
    warnings: string[];
    sectionCount: number;
    aiCalls: number;
    rawConceptCount: number;
    acceptedConceptCount: number;
    existingMemoriesProvided: number;
  } {
    return {
      warnings: Array.isArray(extractionResult?.warnings)
        ? extractionResult.warnings.filter(
          (item: unknown): item is string => typeof item === "string"
        )
        : [],
      sectionCount: Number(extractionResult?.sectionCount ?? 0),
      aiCalls: Number(extractionResult?.aiCalls ?? 0),
      rawConceptCount: Number(
        extractionResult?.rawConceptCount ?? rawConcepts.length
      ),
      acceptedConceptCount: Number(
        extractionResult?.acceptedConceptCount ?? rawConcepts.length
      ),
      existingMemoriesProvided: Number(
        extractionResult?.existingMemoriesProvided ?? 0
      ),
    };
  }

  private async resolveUserId(
    documentId?: string | null
  ): Promise<string | null> {
    if (!documentId || !isValidUuid(documentId)) return null;
    try {
      const row = await queryOne<{ user_id: string | null }>(
        "SELECT user_id FROM documents WHERE document_id = $1::uuid",
        [documentId]
      );
      return row?.user_id ?? null;
    } catch {
      return null;
    }
  }

  private requiredConceptCount(wordCount: number): number {
    if (wordCount < 500) {
      return config.ai.minConceptsTiny;
    }
    if (wordCount < config.ai.largeDocumentWords) {
      return config.ai.minConceptsSmall;
    }
    return config.ai.minConceptsLarge;
  }

  private createConceptsFromRaw(
    rawConcepts: RawConceptFromAI[],
    source: string
  ): Concept[] {
    const seen = new Map<string, Concept>();
    for (const raw of rawConcepts) {
      try {
        const concept = createConceptFromRaw(raw, source);
        if (!concept) continue;
        if (isLowQualityConcept(concept.label, concept.definition)) continue;
        const key = normalizeLabel(concept.label);
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, concept);
        } else if (concept.importance > existing.importance) {
          seen.set(key, concept);
        }
      } catch { }
    }
    return Array.from(seen.values());
  }

  private async embedConceptsParallel(concepts: Concept[]): Promise<{
    concepts: Array<Concept & { embedding: number[] | null }>;
    errors: string[];
  }> {
    if (concepts.length === 0) {
      return { concepts: [], errors: [] };
    }

    const concurrency = Math.max(
      1,
      Math.min(8, Number(config.extraction.embeddingConcurrency) || 8)
    );

    const results: Array<Concept & { embedding: number[] | null }> = [];
    const errors: string[] = [];

    for (let i = 0; i < concepts.length; i += concurrency) {
      const batch = concepts.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(async (concept) => {
          let text = conceptToText(concept);
          const labelLower = concept.label.toLowerCase();
          const isOverview =
            labelLower.includes("overview") ||
            labelLower.includes("summary") ||
            labelLower.includes("abstract");
          if (isOverview) {
            text = `Summary of the document: This document is about ${concept.label}. ${concept.definition}`;
            if (concept.significance) {
              text += ` ${concept.significance}`;
            }
          }
          const embedding = await this.embeddingGenerator.generate(text);
          return { ...concept, embedding };
        })
      );

      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          results.push({ ...batch[j], embedding: null });
          errors.push(
            `Embedding failed for ${batch[j].label}: ${result.reason?.message ?? "unknown error"
            }`
          );
          logger.debug("Embedding failed for concept", {
            label: batch[j].label,
            error: result.reason?.message,
          });
        }
      }
    }

    logger.info("Embedding generation complete", {
      total: concepts.length,
      successful: results.filter((c) => c.embedding !== null).length,
      failed: errors.length,
    });

    return { concepts: results, errors };
  }

  private async storeConcepts(
    concepts: Array<Concept & { embedding?: number[] | null }>, documentId?: string, userId?: string | null
  ): Promise<{ newBuckets: number; mergedBuckets: number; exactMerges: number; bucketIdByLabel: Map<string, string>; mergedBucketIds: string[]; errors: string[]; }> {
    const safeUserId = userId && isValidUuid(userId) ? userId : null;
    const safeDocumentId = documentId && isValidUuid(documentId) ? documentId : null;
    const errors: string[] = [];
    if (concepts.length === 0) return { newBuckets: 0, mergedBuckets: 0, exactMerges: 0, bucketIdByLabel: new Map(), mergedBucketIds: [], errors };

    const bucketEntries = concepts.map((c) => ({ label: c.label, definition: c.definition, conceptType: c.conceptType, importance: c.importance, source: c.source, documentId: safeDocumentId, userId: safeUserId }));
    let bulkResult: { newBuckets: number; mergedBuckets: number; bucketIds: string[] };

    try {
      const { getBucketStore } = await import("../storage/bucket-store");
      bulkResult = await getBucketStore().bulkUpsertBuckets(bucketEntries);
    } catch (error) {
      logger.error("bulkUpsertBuckets failed, falling back", { error: (error as Error).message });
      const bucketIdByLabel = new Map<string, string>(); const mergedBucketIds: string[] = [];
      let newBuckets = 0, mergedBuckets = 0, exactMerges = 0;
      for (const c of concepts) {
        try {
          const { getBucketStore } = await import("../storage/bucket-store");
          const r = await getBucketStore().getOrCreateBucket(c.label, c.definition, c.conceptType, c.importance, c.source, safeDocumentId, safeUserId);
          bucketIdByLabel.set(normalizeLabel(c.label), r.bucketId);
          if (r.isNew) newBuckets++; else { mergedBuckets++; mergedBucketIds.push(r.bucketId); if (r.exactMerge) exactMerges++; }
        } catch (err) { errors.push(`Failed to store ${c.label}: ${(err as Error).message}`); }
      }
      return { newBuckets, mergedBuckets, exactMerges, bucketIdByLabel, mergedBucketIds, errors };
    }

    const bucketIdByLabel = new Map<string, string>();
    for (let i = 0; i < concepts.length; i++) {
      const id = bulkResult.bucketIds[i];
      if (id) bucketIdByLabel.set(normalizeLabel(concepts[i].label), id);
    }

    const embedEntries: Array<{ bucketId: string; vector: number[] }> = [];
    for (let i = 0; i < concepts.length; i++) {
      const c = concepts[i]; const id = bulkResult.bucketIds[i];
      if (!id || !c.embedding || !this.embeddingGenerator.validateEmbedding(c.embedding)) {
        if (id && (!c.embedding || !this.embeddingGenerator.validateEmbedding(c.embedding!))) errors.push(`Missing or invalid embedding for ${c.label}`);
        continue;
      }
      embedEntries.push({ bucketId: id, vector: c.embedding });
    }

    if (embedEntries.length > 0) {
      try {
        const { getEmbeddingStore } = await import("../storage/embedding-store");
        await getEmbeddingStore().batchStoreEmbeddings(embedEntries);
      } catch (error) { errors.push(`Batch embedding store failed: ${(error as Error).message}`); }
    }

    return {
      newBuckets: bulkResult.newBuckets, mergedBuckets: bulkResult.mergedBuckets, exactMerges: bulkResult.mergedBuckets,
      bucketIdByLabel, mergedBucketIds: bulkResult.mergedBuckets > 0 ? bulkResult.bucketIds.slice(concepts.length - bulkResult.mergedBuckets) : [], errors,
    };
  }

  private async syncDocumentRelationships(
    userId: string,
    documentId: string,
    storedConcepts: unknown[],
    rawConcepts: RawConceptFromAI[],
    bucketIdByLabel: Map<string, string>
  ): Promise<number> {
    if (storedConcepts.length < 2) return 0;

    try {
      const { getRelationshipStore } = await import(
        "../storage/relationship-store"
      );
      const relationshipStore = getRelationshipStore() as any;

      const edges: Array<{
        sourceBucketId: string;
        targetBucketId: string;
        sourceLabel: string;
        targetLabel: string;
        relationType: "related_to";
        confidence: number;
        sourceText: string;
      }> = [];

      const seen = new Set<string>();

      for (const raw of rawConcepts) {
        const sourceLabel =
          typeof raw.label === "string" ? raw.label.trim() : "";
        if (!sourceLabel) continue;

        const sourceKey = normalizeLabel(sourceLabel);
        const sourceBucketId = bucketIdByLabel.get(sourceKey);
        if (!sourceBucketId) continue;

        const related = Array.isArray(raw.related)
          ? raw.related.filter((r): r is string => typeof r === "string")
          : [];

        for (const targetLabel of related) {
          const targetKey = normalizeLabel(targetLabel);
          if (!targetKey || targetKey === sourceKey) continue;

          let targetBucketId = bucketIdByLabel.get(targetKey);
          if (
            !targetBucketId &&
            typeof relationshipStore.resolveBucketIdByCanonical === "function"
          ) {
            targetBucketId =
              await relationshipStore.resolveBucketIdByCanonical(
                targetLabel,
                userId,
                documentId
              );
          }
          if (!targetBucketId) continue;

          const edgeKey = [sourceBucketId, targetBucketId].sort().join(":");
          if (seen.has(edgeKey)) continue;
          seen.add(edgeKey);

          edges.push({
            sourceBucketId,
            targetBucketId,
            sourceLabel,
            targetLabel,
            relationType: "related_to",
            confidence: 0.65,
            sourceText: `${sourceLabel} -> ${targetLabel}`,
          });
        }
      }

      if (edges.length === 0) return 0;

      if (typeof relationshipStore.syncFromConcepts === "function") {
        return await relationshipStore.syncFromConcepts({
          userId,
          documentId,
          edges,
        });
      }

      let stored = 0;
      for (const edge of edges) {
        await relationshipStore.createRelationship({
          sourceBucket: edge.sourceLabel,
          targetBucket: edge.targetLabel,
          relationType: edge.relationType,
          confidence: edge.confidence,
          sourceText: edge.sourceText,
          sourceBucketId: edge.sourceBucketId,
          targetBucketId: edge.targetBucketId,
          userId,
          documentId,
        });
        stored++;
      }
      return stored;
    } catch (error) {
      logger.error("syncDocumentRelationships failed", {
        documentId,
        error: (error as Error).message,
      });
      return 0;
    }
  }

  private emptyDocumentResult(
    documentId: string,
    filename: string,
    status: "complete" | "empty" | "failed" | "duplicate",
    durationMs: number,
    errors?: string[]
  ): DocumentIngestionResultPayload {
    const payload: DocumentResultWithConnections = {
      documentId,
      filename,
      status,
      conceptsExtracted: 0,
      newBuckets: 0,
      mergedBuckets: 0,
      relationshipsMapped: 0,
      chunksProcessed: 0,
      chunksFailed: 0,
      durationMs,
      errors,
      connections: emptyConnectionStats(),
      relatedDocuments: [],
      topConnectedMemories: [],
    };
    return payload;
  }

  private emptyIngestionResult(
    durationMs: number,
    errors?: string[]
  ): IngestionResultPayload {
    const payload: IngestionResultWithErrors = {
      conceptsExtracted: 0,
      newBuckets: 0,
      mergedBuckets: 0,
      relationshipsMapped: 0,
      chunksProcessed: 0,
      chunksFailed: 0,
      durationMs,
      errors,
    };
    return payload;
  }
}

let pipelineInstance: IngestionPipeline | null = null;

export function getIngestionPipeline(deps: {
  normalizer: TextNormalizer;
  extractor: ConceptExtractor;
  relationshipMapper: RelationshipMapper;
  embeddingGenerator: EmbeddingGenerator;
  rawStore: RawStoreWriter;
  bucketStore: BucketStoreWriter;
  embeddingStore: EmbeddingStoreWriter;
  aiClient: AIClient;
}): IngestionPipeline {
  if (!pipelineInstance) {
    pipelineInstance = new IngestionPipeline(deps);
  }
  return pipelineInstance;
}