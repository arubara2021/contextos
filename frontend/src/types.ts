export type ConceptType =
  | "problem"
  | "decision"
  | "fact"
  | "entity"
  | "event"
  | "preference"
  | "code";

export type RelationshipType =
  | "causes"
  | "related_to"
  | "replaces"
  | "part_of"
  | "requires"
  | "evolves_into";

export type StrengthCategory = "strong" | "fading" | "critical" | "forgotten";

export type MessageRole = "user" | "assistant" | "system";

export type ProcessingJobStatus =
  | "queued"
  | "processing"
  | "complete"
  | "failed"
  | "duplicate";

export type ProcessingStage =
  | "uploaded"
  | "parsing"
  | "classifying"
  | "chunking"
  | "embedding"
  | "storing"
  | "complete"
  | "failed";

export type ReminderAction = "keep_active" | "archive" | "boost";

export interface User {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface UserResponse {
  user: User;
}

export interface MemorySummary {
  bucketId: string;
  canonical: string;
  strength: number;
  category: StrengthCategory;
  importance: number;
  conceptType: ConceptType;
  lastAccessed: string;
  accessCount: number;
  daysSinceAccess: number;
  createdAt: string;
}

export interface MemoryListResponse {
  memories: MemorySummary[];
  count: number;
  total: number;
  offset: number;
  limit: number;
}

export interface MemoryFilters {
  type?: ConceptType;
  minStrength?: number;
  maxStrength?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MemoryStats {
  totalBuckets: number;
  strongCount: number;
  fadingCount: number;
  criticalCount: number;
  forgottenCount: number;
  totalRelationships: number;
  totalMessages: number;
  totalSessions: number;
  averageStrength: number;
  bucketsByType: Record<string, number>;
}

export interface MemoryItem {
  itemId: string;
  label: string;
  definition: string | null;
  source: string | null;
  timestamp: string;
}

export interface MemoryRelationship {
  relationshipId: string;
  connectedBucketId: string;
  connectedBucketName?: string;
  relationType: RelationshipType;
  confidence: number;
  direction: "outgoing" | "incoming";
}

export interface DecayCurvePoint {
  day: number;
  strength: number;
}

export interface MemoryDetailResponse {
  bucket: MemorySummary;
  items: MemoryItem[];
  relationships: MemoryRelationship[];
  decayCurve: DecayCurvePoint[];
}

export interface MemoryUpdateParams {
  canonical?: string;
  importance?: number;
  conceptType?: ConceptType;
}

export interface InjectedMemory {
  bucketId: string;
  label: string;
  definition: string;
  conceptType: ConceptType;
  relevanceScore: number;
  strength: number;
  source: string;
  rank: number;
  documentId?: string | null;
  documentFilename?: string | null;
  connectionConfidence?: number;
  connectedToCurrentDocument?: boolean;
}

export interface SourceDocument {
  documentId: string;
  filename: string;
  memoryCount: number;
}

export interface RelatedDocument {
  documentId: string;
  filename: string;
  correlation: number;
  sharedConcepts: number;
  edges: number;
  avgConfidence?: number;
}

export interface ConnectionConfidence {
  average: number;
  top: number;
  connectedMemoryCount: number;
}

export interface KnowledgeBaseState {
  memoryCount: number;
  documentCount: number;
  hasKnowledge: boolean;
}

export interface QueryAnalysis {
  keyTerms: string[];
  expandedTerms: string[];
  intent: string;
  specificity: number;
  isAbstractQuery: boolean;
  preferredTypes: ConceptType[];
  documentScoped: boolean;
}

export interface ChatMessage {
  messageId: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface ChatResponse {
  message: ChatMessage;
  injectedMemories: InjectedMemory[];
  memoryTrace?: InjectedMemory[];
  sourceDocuments: SourceDocument[];
  relatedDocuments: RelatedDocument[];
  connectionConfidence: ConnectionConfidence;
  availableMemories: InjectedMemory[];
  totalMemories: number;
  knowledgeBase?: KnowledgeBaseState;
  queryAnalysis: QueryAnalysis;
  processingStats: {
    responseIngestion: {
      conceptsStored: number;
      embeddingsStored: number;
      metadata: Record<string, unknown>;
    } | null;
    context: {
      totalCandidates: number;
      budgetUsed: number;
      budgetMax: number;
      queryAnalysisMs: number;
      retrievalTimeMs: number;
      assemblyTimeMs: number;
    };
    model: {
      modelUsed: string;
      modelTimeMs: number;
    };
    totalDurationMs: number;
  };
}

export interface ChatHistoryResponse {
  sessionId: string;
  messages: Array<{
    messageId: string;
    role: MessageRole;
    content: string;
    timestamp: string;
  }>;
  count: number;
}

export interface Session {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessage: string | null;
  lastMessageRole: MessageRole | null;
  lastMessageAt: string | null;
}

export interface SessionListResponse {
  sessions: Session[];
  count: number;
}

export interface SessionCreated {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface DocumentSummary {
  documentId: string;
  filename: string;
  fileType: string;
  uploadedAt: string;
}

export interface DocumentListResponse {
  documents: DocumentSummary[];
  count: number;
  storage: {
    totalSizeBytes: number;
    totalSizeMB: number;
    objectCount: number;
  };
}

export interface UploadAccepted {
  jobId: string;
  filename: string;
  fileType: string;
  format: string;
  sizeBytes: number;
  status: string;
  s3Key: string | null;
}

export interface IngestionJobResult {
  fileId: string;
  filename: string;
  fieldType: string;
  domain: string;
  status: string;
  chunksCreated: number;
  conceptsExtracted: number;
  embeddingsGenerated: number;
  newBuckets: number;
  mergedBuckets: number;
  durationMs: number;
  errors: string[];
}

export interface ProcessingJob {
  jobId: string;
  fileId: string;
  filename: string;
  format: string;
  status: ProcessingJobStatus;
  stage: ProcessingStage;
  progress: number;
  message: string;
  result: IngestionJobResult | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface DocumentDetailResponse {
  document: {
    documentId: string;
    filename: string;
    fileType: string;
    uploadedAt: string;
    storage: {
      storedIn: string;
      s3Key: string | null;
      contentPreview: string;
    };
  };
  chunks: Array<{
    chunkId: string;
    textPreview: string;
    metadata: Record<string, unknown>;
  }>;
  chunkCount: number;
}

export interface DocumentContentResponse {
  documentId: string;
  filename: string;
  content: string;
  contentLength: number;
  storedIn: string;
  s3Key: string | null;
}

export interface DocumentMemoryRef {
  bucketId: string;
  canonical: string;
  conceptType: ConceptType;
  importance: number;
  strength: number;
}

export interface DocumentMemoriesResponse {
  documentId: string;
  memories: DocumentMemoryRef[];
  count: number;
}

export interface ReminderMemory {
  bucketId: string;
  canonical: string;
  strength: number;
  importance: number;
  daysSinceAccess: number;
}

export interface Reminder {
  reminderId: string;
  message: string;
  memories: ReminderMemory[];
  dismissed: boolean;
  actionTaken?: string | null;
  createdAt: string;
}

export interface ReminderCheckResponse {
  hasReminders: boolean;
  reminder: Reminder | null;
  criticalCount: number;
}

export interface ReminderListResponse {
  reminders: Reminder[];
  count: number;
}

export interface Contradiction {
  contradictionId: string;
  existingBucketId: string;
  newInformation: string;
  conflictDescription: string;
  resolved: boolean;
  createdAt: string;
}

export interface ContradictionListResponse {
  contradictions: Contradiction[];
  count: number;
}

export interface ModelInfo {
  key: string;
  displayName: string;
  provider: string;
  maxTokens: number;
}

export interface Settings {
  models: {
    available: ModelInfo[];
    default: string;
  };
  memory: {
    maxContextMemories: number;
    chunkTargetMin: number;
    chunkTargetMax: number;
  };
  decay: {
    defaultRate: number;
    highImportanceRate: number;
    lowImportanceRate: number;
    strongThreshold: number;
    fadingThreshold: number;
    criticalThreshold: number;
    forgottenThreshold: number;
  };
  scorer: {
    semanticWeight: number;
    strengthWeight: number;
    recencyWeight: number;
  };
  reminders: {
    checkIntervalHours: number;
    minImportance: number;
  };
  currentStats: Record<string, unknown>;
}

export interface SettingsUpdateParams {
  maxContextMemories?: number;
  checkIntervalHours?: number;
  strongThreshold?: number;
  fadingThreshold?: number;
  semanticWeight?: number;
  strengthWeight?: number;
  recencyWeight?: number;
}

export interface ExportStatsResponse {
  exportable: {
    buckets: number;
    relationships: number;
    messages: number;
    sessions: number;
    documents: number;
    embeddings: number;
  };
  storage: {
    totalSizeBytes: number;
    totalSizeMB: number;
    objectCount: number;
  };
}

export interface BackupResponse {
  message: string;
  backupKey: string;
  downloadUrl: string | null;
  summary: Record<string, number>;
  createdAt: string;
}

export interface HealthResponse {
  status: "healthy" | "degraded" | "unhealthy";
  version: string;
  uptime: number;
  timestamp: string;
  environment: string;
}

export interface ApiErrorBody {
  error: string;
  details?: string;
}

export type CortexViewMode = "core" | "document";

export type CortexDocumentState =
  | "connected"
  | "solo"
  | "processing"
  | "empty";

export type CortexMemoryLinkState = "linked" | "island";

export type CortexFilterMode = "all" | "linked" | "islands";

export interface CortexCoreSummary {
  totalMemories: number;
  averageStrength: number;
  criticalCount: number;
  documentCount: number;
  totalRelationships: number;
}

export interface CortexRelatedDocument {
  documentId: string;
  filename: string;
  sharedConcepts: number;
  correlation?: number;
}

export interface CortexTopConcept {
  bucketId: string;
  canonical: string;
}

export interface CortexDocumentNode {
  documentId: string;
  filename: string;
  fileType: string;
  uploadedAt: string;
  state?: CortexDocumentState;
  conceptCount: number;
  averageStrength: number;
  criticalCount: number;
  connectedConceptCount: number;
  isolatedConceptCount: number;
  relatedDocuments: CortexRelatedDocument[];
  topConcepts: CortexTopConcept[];
  solo: boolean;
}

export interface CortexConcept extends MemorySummary {
  documentId: string | null;
  linkState?: CortexMemoryLinkState;
  degree?: number;
}

export interface CortexRelationship {
  relationshipId: string;
  sourceBucket: string;
  targetBucket: string;
  relationType: string;
  confidence: number;
  crossDocument?: boolean;
}

export interface CortexDocumentEdge {
  id: string;
  sourceDocumentId: string;
  targetDocumentId: string;
  sharedConcepts: number;
  correlation?: number;
}

export interface CortexMapResponse {
  core: CortexCoreSummary;
  documents: CortexDocumentNode[];
  concepts: CortexConcept[];
  relationships: CortexRelationship[];
  bucketDocumentMap: Record<string, string | null>;
  conceptDegree: Record<string, number>;
  documentEdges?: CortexDocumentEdge[];
}