import type { InjectedMemory } from "./context.model";

export interface MessageRow {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  timestamp: Date;
}

export type MessageRole = "user" | "assistant" | "system";

export const MESSAGE_ROLES: readonly MessageRole[] = ["user", "assistant", "system"];

export function isMessageRole(value: string): value is MessageRole {
  return (MESSAGE_ROLES as readonly string[]).includes(value);
}

export function parseMessageRole(value: string): MessageRole {
  const normalized = value.toLowerCase().trim();
  if (isMessageRole(normalized)) return normalized;
  return "user";
}

export interface Message {
  messageId: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
}

export interface ChatRequest {
  message: string;
  sessionId: string;
  modelId?: string;
}

export interface ChatResponse {
  message: Message;
  injectedMemories: InjectedMemory[];
  availableMemories: InjectedMemory[];
  totalMemories: number;
  processingStats: ProcessingStats;
}

export interface ProcessingStats {
  userIngestion: IngestionSummary;
  responseIngestion: IngestionSummary;
  context: ContextSummary;
}

export interface IngestionSummary {
  conceptsExtracted: number;
  newBuckets: number;
  mergedBuckets: number;
  relationshipsMapped: number;
}

export interface ContextSummary {
  totalCandidates: number;
  budgetUsed: number;
  budgetMax: number;
  retrievalTimeMs: number;
  scoringTimeMs: number;
  assemblyTimeMs: number;
}

export function mapRowToMessage(row: MessageRow): Message {
  return {
    messageId: row.message_id,
    sessionId: row.session_id,
    role: parseMessageRole(row.role),
    content: row.content,
    timestamp: new Date(row.timestamp),
  };
}

export function validateChatRequest(body: unknown): ChatRequest | null {
  if (!body || typeof body !== "object") return null;

  const obj = body as Record<string, unknown>;

  if (typeof obj.message !== "string") return null;
  if (typeof obj.sessionId !== "string") return null;

  const message = obj.message.trim();
  const sessionId = obj.sessionId.trim();

  if (!message || message.length === 0) return null;
  if (!sessionId || sessionId.length === 0) return null;
  if (message.length > 100000) return null;
  if (sessionId.length > 255) return null;

  const modelId = typeof obj.modelId === "string" ? obj.modelId.trim() : undefined;

  return {
    message,
    sessionId,
    modelId: modelId || undefined,
  };
}

export function createMessage(
  sessionId: string,
  role: MessageRole,
  content: string,
  messageId?: string
): Message {
  return {
    messageId: messageId ?? "",
    sessionId,
    role,
    content,
    timestamp: new Date(),
  };
}

export function buildChatResponse(
  message: Message,
  injectedMemories: InjectedMemory[],
  availableMemories: InjectedMemory[],
  processingStats: ProcessingStats
): ChatResponse {
  return {
    message,
    injectedMemories,
    availableMemories,
    totalMemories: injectedMemories.length + availableMemories.length,
    processingStats,
  };
}

export function emptyIngestionSummary(): IngestionSummary {
  return {
    conceptsExtracted: 0,
    newBuckets: 0,
    mergedBuckets: 0,
    relationshipsMapped: 0,
  };
}

export function emptyContextSummary(): ContextSummary {
  return {
    totalCandidates: 0,
    budgetUsed: 0,
    budgetMax: 0,
    retrievalTimeMs: 0,
    scoringTimeMs: 0,
    assemblyTimeMs: 0,
  };
}

export function mergeIngestionSummaries(...summaries: IngestionSummary[]): IngestionSummary {
  return summaries.reduce(
    (acc, s) => ({
      conceptsExtracted: acc.conceptsExtracted + s.conceptsExtracted,
      newBuckets: acc.newBuckets + s.newBuckets,
      mergedBuckets: acc.mergedBuckets + s.mergedBuckets,
      relationshipsMapped: acc.relationshipsMapped + s.relationshipsMapped,
    }),
    emptyIngestionSummary()
  );
}

export function messagePreview(content: string, maxLength: number = 80): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return cleaned.substring(0, maxLength - 3) + "...";
}