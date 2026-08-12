import type { ConceptType } from "../models/concept.model";

export type FileFormat = "pdf" | "docx" | "md" | "json" | "csv" | "txt" | "html" | "code" | "yaml" | "unknown";
export type FieldType = "research-paper" | "study-material" | "textbook" | "book" | "documentation" | "code" | "notes" | "report" | "article" | "other";
export type FieldDomain = "physics" | "mathematics" | "computer-science" | "medicine" | "biology" | "chemistry" | "law" | "business" | "engineering" | "humanities" | "science" | "technology" | "general" | "other";
export type ConfidenceLevel = "high" | "medium" | "low";
export type ProcessingStrategyName = "research-paper" | "study-material" | "code-docs" | "book" | "general";
export type ProcessingJobStatus = "queued" | "processing" | "complete" | "failed" | "duplicate";
export type ProcessingStage =
  | "uploaded"
  | "parsing"
  | "classifying"
  | "chunking"
  | "extracting"
  | "embedding"
  | "storing"
  | "correlating"
  | "complete"
  | "failed";

export interface NormalizedChunkRow {
  text: string;
  role: string;
  source: string;
  session_id: string;
  timestamp: string | null;
  chunk_index: number;
  token_estimate: number;
}

export interface ExtractionResultRow {
  label: string;
  definition: string;
  concept_type: string;
  importance: number;
  source: string;
  related_terms: string[];
  embedding: number[] | null;
}

export interface ConnectionStats {
  exactMerges: number;
  semanticConnections: number;
  crossDocumentConnections: number;
  strongConnections: number;
  connectionScore: number;
}

export interface RelatedDocumentSummary {
  documentId: string;
  filename: string;
  correlation: number;
  sharedConcepts: number;
  edges: number;
  avgConfidence?: number;
}

export interface TopConnectedMemory {
  bucketId: string;
  label: string;
  relationType: string;
  confidence: number;
  documentId: string | null;
}

export interface ExistingMemoryContext {
  bucketId: string;
  label: string;
  definition: string | null;
  conceptType: string;
  importance: number;
  strength: number;
  documentId: string | null;
}

export interface ExtractionQualityMetadata {
  warnings: string[];
  sectionCount: number;
  aiCalls: number;
  rawConceptCount: number;
  acceptedConceptCount: number;
  existingMemoriesProvided: number;
}

export interface DocumentCorrelationPayload {
  connections: ConnectionStats;
  relatedDocuments: RelatedDocumentSummary[];
  topConnectedMemories: TopConnectedMemory[];
}

export interface IngestionResultPayload {
  conceptsExtracted: number;
  newBuckets: number;
  mergedBuckets: number;
  relationshipsMapped: number;
  chunksProcessed: number;
  chunksFailed: number;
  durationMs: number;
}

export interface DocumentIngestionResultPayload extends IngestionResultPayload {
  documentId: string;
  filename: string;
  status: "complete" | "empty" | "failed" | "duplicate";
  connections?: ConnectionStats;
  relatedDocuments?: RelatedDocumentSummary[];
  topConnectedMemories?: TopConnectedMemory[];
  extraction?: ExtractionQualityMetadata;
}

export interface IngestionEventRow {
  event_id: string;
  event_type: "message" | "document";
  source_id: string;
  session_id: string | null;
  filename: string | null;
  chunks_created: number;
  concepts_extracted: number;
  buckets_created: number;
  buckets_merged: number;
  relationships_created: number;
  duration_ms: number;
  created_at: Date;
}

export interface ChunkMetadataRow {
  chunk_id: string;
  message_id: string;
  text: string;
  role: string;
  source: string;
  session_id: string;
  timestamp: string | null;
  chunk_index: number;
  token_estimate: number;
}

export interface ReprocessorResultPayload {
  totalChunks: number;
  chunksProcessed: number;
  chunksFailed: number;
  conceptsExtracted: number;
  newBuckets: number;
  mergedBuckets: number;
  relationshipsMapped: number;
  durationMs: number;
}

export interface IngestionPipelineConfig {
  chunkTargetMin: number;
  chunkTargetMax: number;
  maxConceptsPerChunk: number;
  maxRetries: number;
  retryDelayMs: number;
  embeddingDimension: number;
  relationshipSimilarityMin: number;
  relationshipSimilarityMax: number;
  crossChunkConfidence: number;
  maxConcurrency: number;
}

export interface IngestionStatsRow {
  total_messages_ingested: number;
  total_documents_ingested: number;
  total_chunks_created: number;
  total_concepts_extracted: number;
  total_buckets_created: number;
  total_relationships_created: number;
  avg_concepts_per_chunk: number;
  avg_chunks_per_message: number;
  avg_ingestion_duration_ms: number;
}

export interface ExtractionFeedbackRow {
  feedback_id: string;
  chunk_id: string;
  label: string;
  action: "accepted" | "rejected" | "modified";
  original_definition: string | null;
  corrected_definition: string | null;
  created_at: Date;
}

export interface IngestionErrorRow {
  error_id: string;
  source_type: "message" | "document";
  source_id: string;
  stage: "normalize" | "extract" | "embed" | "store" | "relate";
  error_message: string;
  error_stack: string | null;
  retry_count: number;
  created_at: Date;
}

export const INGESTION_STAGES = [
  "normalize",
  "extract",
  "embed",
  "store",
  "relate",
] as const;

export type IngestionStage = typeof INGESTION_STAGES[number];

export function isIngestionStage(value: string): value is IngestionStage {
  return (INGESTION_STAGES as readonly string[]).includes(value);
}

function clampUnit(value: unknown): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function nonNegativeInt(value: unknown): number {
  const num = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function emptyConnectionStats(): ConnectionStats {
  return {
    exactMerges: 0,
    semanticConnections: 0,
    crossDocumentConnections: 0,
    strongConnections: 0,
    connectionScore: 0,
  };
}

export function emptyExtractionQualityMetadata(): ExtractionQualityMetadata {
  return {
    warnings: [],
    sectionCount: 0,
    aiCalls: 0,
    rawConceptCount: 0,
    acceptedConceptCount: 0,
    existingMemoriesProvided: 0,
  };
}

export function emptyDocumentCorrelationPayload(): DocumentCorrelationPayload {
  return {
    connections: emptyConnectionStats(),
    relatedDocuments: [],
    topConnectedMemories: [],
  };
}

export function validateConnectionStats(payload: unknown): ConnectionStats | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  return {
    exactMerges: nonNegativeInt(obj.exactMerges),
    semanticConnections: nonNegativeInt(obj.semanticConnections),
    crossDocumentConnections: nonNegativeInt(obj.crossDocumentConnections),
    strongConnections: nonNegativeInt(obj.strongConnections),
    connectionScore: clampUnit(obj.connectionScore),
  };
}

export function validateRelatedDocumentSummary(payload: unknown): RelatedDocumentSummary | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const documentId = optionalString(obj.documentId);
  const filename = optionalString(obj.filename);
  if (!documentId || !filename) return null;
  const result: RelatedDocumentSummary = {
    documentId,
    filename,
    correlation: clampUnit(obj.correlation),
    sharedConcepts: nonNegativeInt(obj.sharedConcepts),
    edges: nonNegativeInt(obj.edges),
  };
  if (obj.avgConfidence !== undefined) {
    result.avgConfidence = clampUnit(obj.avgConfidence);
  }
  return result;
}

export function validateTopConnectedMemory(payload: unknown): TopConnectedMemory | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const bucketId = optionalString(obj.bucketId);
  const label = optionalString(obj.label);
  if (!bucketId || !label) return null;
  return {
    bucketId,
    label,
    relationType: optionalString(obj.relationType) ?? "related_to",
    confidence: clampUnit(obj.confidence),
    documentId: optionalString(obj.documentId),
  };
}

export function validateExtractionQualityMetadata(payload: unknown): ExtractionQualityMetadata | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  return {
    warnings: Array.isArray(obj.warnings)
      ? obj.warnings.filter((item): item is string => typeof item === "string")
      : [],
    sectionCount: nonNegativeInt(obj.sectionCount),
    aiCalls: nonNegativeInt(obj.aiCalls),
    rawConceptCount: nonNegativeInt(obj.rawConceptCount),
    acceptedConceptCount: nonNegativeInt(obj.acceptedConceptCount),
    existingMemoriesProvided: nonNegativeInt(obj.existingMemoriesProvided),
  };
}

export function emptyIngestionResult(): IngestionResultPayload {
  return {
    conceptsExtracted: 0,
    newBuckets: 0,
    mergedBuckets: 0,
    relationshipsMapped: 0,
    chunksProcessed: 0,
    chunksFailed: 0,
    durationMs: 0,
  };
}

export function emptyDocumentIngestionResult(): DocumentIngestionResultPayload {
  return {
    ...emptyIngestionResult(),
    documentId: "",
    filename: "",
    status: "empty",
    connections: emptyConnectionStats(),
    relatedDocuments: [],
    topConnectedMemories: [],
  };
}

export function emptyReprocessorResult(): ReprocessorResultPayload {
  return {
    totalChunks: 0,
    chunksProcessed: 0,
    chunksFailed: 0,
    conceptsExtracted: 0,
    newBuckets: 0,
    mergedBuckets: 0,
    relationshipsMapped: 0,
    durationMs: 0,
  };
}

export function mergeIngestionResults(
  ...results: IngestionResultPayload[]
): IngestionResultPayload {
  return results.reduce(
    (acc, r) => ({
      conceptsExtracted: acc.conceptsExtracted + r.conceptsExtracted,
      newBuckets: acc.newBuckets + r.newBuckets,
      mergedBuckets: acc.mergedBuckets + r.mergedBuckets,
      relationshipsMapped: acc.relationshipsMapped + r.relationshipsMapped,
      chunksProcessed: acc.chunksProcessed + r.chunksProcessed,
      chunksFailed: acc.chunksFailed + r.chunksFailed,
      durationMs: acc.durationMs + r.durationMs,
    }),
    emptyIngestionResult()
  );
}

export function buildDefaultIngestionPipelineConfig(): IngestionPipelineConfig {
  return {
    chunkTargetMin: 150,
    chunkTargetMax: 250,
    maxConceptsPerChunk: 15,
    maxRetries: 2,
    retryDelayMs: 1000,
    embeddingDimension: 1024,
    relationshipSimilarityMin: 0.5,
    relationshipSimilarityMax: 0.95,
    crossChunkConfidence: 0.8,
    maxConcurrency: 3,
  };
}

export function validateIngestionResultPayload(
  payload: unknown
): IngestionResultPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.conceptsExtracted !== "number") return null;
  if (typeof obj.newBuckets !== "number") return null;
  if (typeof obj.mergedBuckets !== "number") return null;
  if (typeof obj.relationshipsMapped !== "number") return null;
  if (typeof obj.chunksProcessed !== "number") return null;
  if (typeof obj.chunksFailed !== "number") return null;
  if (typeof obj.durationMs !== "number") return null;
  return {
    conceptsExtracted: Math.max(0, Math.round(obj.conceptsExtracted)),
    newBuckets: Math.max(0, Math.round(obj.newBuckets)),
    mergedBuckets: Math.max(0, Math.round(obj.mergedBuckets)),
    relationshipsMapped: Math.max(0, Math.round(obj.relationshipsMapped)),
    chunksProcessed: Math.max(0, Math.round(obj.chunksProcessed)),
    chunksFailed: Math.max(0, Math.round(obj.chunksFailed)),
    durationMs: Math.max(0, Math.round(obj.durationMs)),
  };
}

export function validateDocumentIngestionResultPayload(
  payload: unknown
): DocumentIngestionResultPayload | null {
  const base = validateIngestionResultPayload(payload);
  if (!base) return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.documentId !== "string") return null;
  if (typeof obj.filename !== "string") return null;

  const validStatuses = ["complete", "empty", "failed", "duplicate"];
  const status =
    typeof obj.status === "string" && validStatuses.includes(obj.status)
      ? (obj.status as DocumentIngestionResultPayload["status"])
      : "empty";

  const result: DocumentIngestionResultPayload = {
    ...base,
    documentId: obj.documentId,
    filename: obj.filename,
    status,
  };

  const connections =
    obj.connections !== undefined ? validateConnectionStats(obj.connections) : null;
  if (connections) {
    result.connections = connections;
  }

  if (Array.isArray(obj.relatedDocuments)) {
    const relatedDocuments = obj.relatedDocuments
      .map(validateRelatedDocumentSummary)
      .filter((item): item is RelatedDocumentSummary => item !== null);
    if (relatedDocuments.length > 0) {
      result.relatedDocuments = relatedDocuments;
    }
  }

  if (Array.isArray(obj.topConnectedMemories)) {
    const topConnectedMemories = obj.topConnectedMemories
      .map(validateTopConnectedMemory)
      .filter((item): item is TopConnectedMemory => item !== null);
    if (topConnectedMemories.length > 0) {
      result.topConnectedMemories = topConnectedMemories;
    }
  }

  const extraction =
    obj.extraction !== undefined
      ? validateExtractionQualityMetadata(obj.extraction)
      : null;
  if (extraction) {
    result.extraction = extraction;
  }

  return result;
}

export function mapChunkMetadataToNormalizedChunk(
  row: ChunkMetadataRow
): NormalizedChunkRow {
  return {
    text: row.text,
    role: row.role,
    source: row.source,
    session_id: row.session_id,
    timestamp: row.timestamp,
    chunk_index: Number(row.chunk_index),
    token_estimate: Number(row.token_estimate),
  };
}

export function computeIngestionEfficiency(
  result: IngestionResultPayload
): {
  conceptRate: number;
  bucketRate: number;
  relationshipRate: number;
  successRate: number;
} {
  const conceptRate =
    result.chunksProcessed > 0
      ? Math.round((result.conceptsExtracted / result.chunksProcessed) * 100) / 100
      : 0;

  const bucketRate =
    result.conceptsExtracted > 0
      ? Math.round(((result.newBuckets + result.mergedBuckets) / result.conceptsExtracted) * 100) / 100
      : 0;

  const relationshipRate =
    result.conceptsExtracted > 1
      ? Math.round((result.relationshipsMapped / result.conceptsExtracted) * 100) / 100
      : 0;

  const totalChunks = result.chunksProcessed + result.chunksFailed;
  const successRate =
    totalChunks > 0
      ? Math.round((result.chunksProcessed / totalChunks) * 10000) / 10000
      : 0;

  return { conceptRate, bucketRate, relationshipRate, successRate };
}

export interface FormatDetectionResult {
  format: FileFormat;
  mimeType: string;
  extension: string;
  isBinary: boolean;
  sizeBytes: number;
}

export interface EmbeddedFileMetadata {
  title: string | null;
  author: string | null;
  date: string | null;
  subject: string | null;
  creator: string | null;
  pageCount: number | null;
}

export interface StructuralFingerprint {
  wordCount: number;
  pageCount: number | null;
  sectionCount: number;
  hasReferences: boolean;
  hasFormulas: boolean;
  hasCodeBlocks: boolean;
  hasTables: boolean;
  hasImages: boolean;
  hasNumberedSections: boolean;
  headings: string[];
  firstChunk: string;
  lastChunk: string;
  citationCount: number;
  avgParagraphLength: number;
  language: string;
  embeddedMetadata: EmbeddedFileMetadata;
}

export interface FieldClassification {
  fieldType: FieldType;
  domain: FieldDomain;
  confidence: ConfidenceLevel;
  strategy: ProcessingStrategyName;
  notes: string;
}

export interface DocumentSection {
  heading: string | null;
  level: number;
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface ParsedDocument {
  format: FileFormat;
  text: string;
  structure: StructuralFingerprint;
  sections: DocumentSection[];
  parseErrors: string[];
}

export interface MetadataGateResult {
  fileId: string;
  format: FileFormat;
  fieldType: FieldType;
  domain: FieldDomain;
  confidence: ConfidenceLevel;
  strategy: ProcessingStrategyName;
  wordCount: number;
  pageCount: number | null;
  language: string;
  sectionStructure: string[];
  extractedTitle: string | null;
  extractedAuthors: string[];
  hasReferences: boolean;
  hasFormulas: boolean;
  hasCode: boolean;
  hasTables: boolean;
  hasImages: boolean;
  warnings: string[];
  parsed: ParsedDocument;
  lockedAt: string;
}

export interface KeywordConcept {
  label: string;
  definition: string;
  type: ConceptType;
  importance: number;
  source: string;
}

export interface PreparedChunk {
  text: string;
  section: string | null;
  chunkIndex: number;
  tokenEstimate: number;
  keywords: KeywordConcept[];
  metadata: Record<string, unknown>;
}

export interface FastIngestionResult {
  fileId: string;
  filename: string;
  fieldType: FieldType;
  domain: FieldDomain;
  status: ProcessingJobStatus;
  chunksCreated: number;
  conceptsExtracted: number;
  embeddingsGenerated: number;
  newBuckets: number;
  mergedBuckets: number;
  durationMs: number;
  errors: string[];
  connections?: ConnectionStats;
  relatedDocuments?: RelatedDocumentSummary[];
  topConnectedMemories?: TopConnectedMemory[];
  extraction?: ExtractionQualityMetadata;
}

export interface DocumentProcessingJob {
  jobId: string;
  fileId: string;
  filename: string;
  fileType: string;
  format: FileFormat;
  mimeType: string;
  sizeBytes: number;
  userId: string;
  sessionId: string | null;
  s3Key: string | null;
  status: ProcessingJobStatus;
  stage: ProcessingStage;
  progress: number;
  message: string;
  result: FastIngestionResult | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}