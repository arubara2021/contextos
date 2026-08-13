import type {
  ApiErrorBody,
  AuthResponse,
  BackupResponse,
  ChatHistoryResponse,
  ChatResponse,
  ConceptType,
  ContradictionListResponse,
  DocumentContentResponse,
  DocumentDetailResponse,
  DocumentListResponse,
  DocumentMemoriesResponse,
  ExportStatsResponse,
  HealthResponse,
  MemoryDetailResponse,
  MemoryFilters,
  MemoryListResponse,
  MemoryStats,
  MemorySummary,
  MemoryUpdateParams,
  ProcessingJob,
  RelationshipType,
  ReminderAction,
  ReminderCheckResponse,
  ReminderListResponse,
  Session,
  SessionCreated,
  SessionListResponse,
  Settings,
  SettingsUpdateParams,
  StrengthCategory,
  UploadAccepted,
  User,
  UserResponse,
} from "./types";
import { STORAGE_KEYS } from "./constants";

const DEV_BYPASS_TOKEN =
  (import.meta.env.VITE_DEV_BYPASS_TOKEN as string | undefined)?.trim() || null;


const BASE_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "/api";

export const UNAUTHORIZED_EVENT = "contextos:unauthorized";

export class ApiError extends Error {
  readonly status: number;
  readonly details?: string;

  constructor(status: number, message: string, details?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

function decodeJwt(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - base64.length % 4) % 4), "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary.split("").map((char) => char.charCodeAt(0)));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}



export function getToken(): string | null {
  return (
    sessionStorage.getItem(STORAGE_KEYS.token) ??
    localStorage.getItem(STORAGE_KEYS.token) ??
    DEV_BYPASS_TOKEN
  );
}

export function isSessionOnly(): boolean {
  return (
    sessionStorage.getItem(STORAGE_KEYS.token) !== null &&
    localStorage.getItem(STORAGE_KEYS.token) === null
  );
}

export function setToken(token: string, remember = true): void {
  sessionStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.token);
  if (remember) {
    localStorage.setItem(STORAGE_KEYS.token, token);
  } else {
    sessionStorage.setItem(STORAGE_KEYS.token, token);
  }
}

export function clearToken(): void {
  sessionStorage.removeItem(STORAGE_KEYS.token);
  sessionStorage.removeItem(STORAGE_KEYS.user);
  localStorage.removeItem(STORAGE_KEYS.token);
  localStorage.removeItem(STORAGE_KEYS.user);
}

export function getStoredUser(): User | null {
  const raw =
    sessionStorage.getItem(STORAGE_KEYS.user) ?? localStorage.getItem(STORAGE_KEYS.user);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as User;
  } catch {
    return null;
  }
}

export function setStoredUser(user: User, remember?: boolean): void {
  const persist = remember ?? !isSessionOnly();
  sessionStorage.removeItem(STORAGE_KEYS.user);
  localStorage.removeItem(STORAGE_KEYS.user);
  const serialized = JSON.stringify(user);
  if (persist) {
    localStorage.setItem(STORAGE_KEYS.user, serialized);
  } else {
    sessionStorage.setItem(STORAGE_KEYS.user, serialized);
  }
}

export function getTokenExpiresAt(): number | null {
  const token = getToken();
  if (!token) {
    return null;
  }
  const payload = decodeJwt(token);
  if (!payload || typeof payload.exp !== "number") {
    return null;
  }
  return payload.exp * 1000;
}

export function isTokenExpired(): boolean {
  const token = getToken();
  if (!token) return true;

  if (DEV_BYPASS_TOKEN && token === DEV_BYPASS_TOKEN) {
    return false;
  }

  const expires = getTokenExpiresAt();

  if (expires === null) {
    return false;
  }

  return expires <= Date.now() + 15000;
} ``

interface RequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  auth?: boolean;
  timeout?: number;
}

function buildQuery(
  params: Record<string, string | number | boolean | undefined>
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const queryString = search.toString();
  return queryString ? `?${queryString}` : "";
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = "GET",
    body,
    formData,
    auth = true,
    timeout,
  } = options;

  if (auth) {
    const currentToken = getToken();
    if (!currentToken || isTokenExpired()) {
      clearToken();
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
      throw new ApiError(401, "Session expired");
    }
  }

  const headers: Record<string, string> = {};
  const token = getToken();
  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let payload: BodyInit | undefined;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timeoutMs = timeout ?? (formData ? 180000 : 30000);
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: payload,
      signal: controller.signal,
    });
    if (response.status === 401 && auth) {
      const shouldForceLogout =
        isTokenExpired() ||
        path.includes("/users/me") ||
        path.includes("/users/login") ||
        path.includes("/users/register") ||
        path.includes("/demo/start");

      if (shouldForceLogout) {
        clearToken();
        window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
      }
    }

    // If the user profile returns 404, the user was deleted from the DB (e.g. DB wipe or sandbox expired)
    if (response.status === 404 && auth && path.includes("/users/me")) {
      clearToken();
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }

    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
    }

    if (!response.ok) {
      const errorBody = data as ApiErrorBody | null;
      throw new ApiError(
        response.status,
        errorBody?.error ?? `Request failed with status ${response.status}`,
        errorBody?.details
      );
    }

    return data as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if ((error as Error).name === "AbortError") {
      throw new ApiError(0, "Request timed out");
    }
    if (error instanceof TypeError) {
      throw new ApiError(0, "Network request failed");
    }
    throw new ApiError(0, "Request failed");
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export interface CortexExportBucket {
  bucketId: string;
  canonical: string;
  strength: number;
  category: StrengthCategory;
  importance: number;
  conceptType: ConceptType;
  lastAccessed: string;
  accessCount: number;
  decayRate: number;
  createdAt: string;
}

export interface CortexExportRelationship {
  relationshipId: string;
  sourceBucket: string;
  targetBucket: string;
  relationType: string;
  confidence: number;
}

export interface CortexConcept extends MemorySummary {
  documentId: string | null;
}

export interface CortexRelatedDocument {
  documentId: string;
  filename: string;
  sharedConcepts: number;
}

export interface CortexDocumentNode {
  documentId: string;
  filename: string;
  fileType: string;
  uploadedAt: string;
  conceptCount: number;
  averageStrength: number;
  criticalCount: number;
  connectedConceptCount: number;
  isolatedConceptCount: number;
  relatedDocuments: CortexRelatedDocument[];
  topConcepts: Array<{
    bucketId: string;
    canonical: string;
  }>;
  solo: boolean;
}

export interface CortexCoreSummary {
  totalMemories: number;
  averageStrength: number;
  criticalCount: number;
  documentCount: number;
  totalRelationships: number;
}

export interface CortexRelationship {
  relationshipId: string;
  sourceBucket: string;
  targetBucket: string;
  relationType: string;
  confidence: number;
}

export interface CortexMapResponse {
  core: CortexCoreSummary;
  documents: CortexDocumentNode[];
  concepts: CortexConcept[];
  relationships: CortexRelationship[];
  bucketDocumentMap: Record<string, string | null>;
  conceptDegree: Record<string, number>;
}

/* ---------------------------------------------------------------------------
 * RELATIONSHIP NORMALIZATION (FIX 1)
 * Makes the Cortex graph immune to payload shape mismatches from
 * /export/memories (snake_case keys, *_id variants, canonical names,
 * unknown relation type strings). Without this, edges silently die
 * and every node gets flagged as an island.
 * ------------------------------------------------------------------------- */

const RELATIONSHIP_TYPE_ALIASES: Record<string, RelationshipType> = {
  causes: "causes",
  cause: "causes",
  caused_by: "causes",
  related_to: "related_to",
  related: "related_to",
  relates_to: "related_to",
  associated_with: "related_to",
  replaces: "replaces",
  replaced_by: "replaces",
  part_of: "part_of",
  partof: "part_of",
  member_of: "part_of",
  contains: "part_of",
  requires: "requires",
  required_by: "requires",
  depends_on: "requires",
  evolves_into: "evolves_into",
  evolvesinto: "evolves_into",
  evolved_from: "evolves_into",
};

export function normalizeRelationType(value: unknown): RelationshipType {
  if (typeof value === "string") {
    const key = value.trim().toLowerCase();
    if (key.length > 0) return RELATIONSHIP_TYPE_ALIASES[key] ?? "related_to";
  }
  return "related_to";
}

function pickStringValue(raw: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

export function normalizeExportRelationships(
  rawRelationships: unknown,
  buckets: CortexExportBucket[]
): CortexRelationship[] {
  if (!Array.isArray(rawRelationships)) return [];

  const bucketIds = new Set(buckets.map((bucket) => bucket.bucketId));
  const canonicalToId = new Map<string, string>();
  for (const bucket of buckets) {
    const key = bucket.canonical.toLowerCase();
    if (!canonicalToId.has(key)) canonicalToId.set(key, bucket.bucketId);
  }

  const resolveBucket = (value: string | null): string | null => {
    if (!value) return null;
    if (bucketIds.has(value)) return value;
    return canonicalToId.get(value.toLowerCase()) ?? null;
  };

  const normalized: CortexRelationship[] = [];
  const seen = new Set<string>();

  for (const entry of rawRelationships) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;

    const source = resolveBucket(
      pickStringValue(raw, [
        "sourceBucket",
        "source_bucket",
        "sourceBucketId",
        "source_bucket_id",
        "source",
      ])
    );
    const target = resolveBucket(
      pickStringValue(raw, [
        "targetBucket",
        "target_bucket",
        "targetBucketId",
        "target_bucket_id",
        "target",
      ])
    );

    if (!source || !target || source === target) continue;

    const relationshipId =
      pickStringValue(raw, ["relationshipId", "relationship_id", "id"]) ??
      `${source}->${target}`;
    const pairKey = `${source}|${target}`;
    if (seen.has(relationshipId) || seen.has(pairKey)) continue;
    seen.add(relationshipId);
    seen.add(pairKey);

    normalized.push({
      relationshipId,
      sourceBucket: source,
      targetBucket: target,
      relationType: normalizeRelationType(raw.relationType ?? raw.relation_type),
      confidence:
        typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
          ? raw.confidence
          : 0.65,
    });
  }

  return normalized;
}

export const api = {
  auth: {
    register(email: string, password: string, displayName: string) {
      return request<AuthResponse>("/users/register", {
        method: "POST",
        auth: false,
        body: { email, password, displayName },
      });
    },
    login(email: string, password: string) {
      return request<AuthResponse>("/users/login", {
        method: "POST",
        auth: false,
        body: { email, password },
      });
    },
    me() {
      return request<UserResponse>("/users/me");
    },
    updateMe(params: { email?: string; displayName?: string }) {
      return request<UserResponse>("/users/me", {
        method: "PATCH",
        body: params,
      });
    },
    updatePassword(currentPassword: string, newPassword: string) {
      return request<{ message: string }>("/users/me/password", {
        method: "PATCH",
        body: { currentPassword, newPassword },
      });
    },
  },
  memories: {
    list(filters: MemoryFilters = {}) {
      return request<MemoryListResponse>(
        `/memories${buildQuery({
          type: filters.type,
          minStrength: filters.minStrength,
          maxStrength: filters.maxStrength,
          search: filters.search,
          limit: filters.limit,
          offset: filters.offset,
        })}`
      );
    },
    stats() {
      return request<MemoryStats>("/memories/stats");
    },
    get(bucketId: string) {
      return request<MemoryDetailResponse>(`/memories/${bucketId}`);
    },
    update(bucketId: string, params: MemoryUpdateParams) {
      return request<{ message: string; bucketId: string }>(
        `/memories/${bucketId}`,
        {
          method: "PATCH",
          body: params,
        }
      );
    },
    remove(bucketId: string) {
      return request<{ message: string; bucketId: string }>(
        `/memories/${bucketId}`,
        {
          method: "DELETE",
        }
      );
    },
  },
  chat: {
    send(message: string, sessionId: string, modelId?: string) {
      return request<ChatResponse>("/chat", {
        method: "POST",
        body: { message, sessionId, modelId },
        timeout: 180000,
      });
    },
    history(sessionId: string) {
      return request<ChatHistoryResponse>(`/chat/${sessionId}/history`);
    },
  },
  sessions: {
    list() {
      return request<SessionListResponse>("/sessions");
    },
    create(title?: string) {
      return request<SessionCreated>("/sessions", {
        method: "POST",
        body: title ? { title } : {},
      });
    },
    get(sessionId: string) {
      return request<Session>(`/sessions/${sessionId}`);
    },
    update(sessionId: string, title: string) {
      return request<Session>(`/sessions/${sessionId}`, {
        method: "PATCH",
        body: { title },
      });
    },
    remove(sessionId: string) {
      return request<{ message: string; sessionId: string }>(
        `/sessions/${sessionId}`,
        {
          method: "DELETE",
        }
      );
    },
  },
  documents: {
    upload(file: File, sessionId?: string) {
      const formData = new FormData();
      formData.append("file", file);
      if (sessionId) {
        formData.append("sessionId", sessionId);
      }
      return request<UploadAccepted>("/documents/upload", {
        method: "POST",
        formData,
      });
    },
    job(jobId: string) {
      return request<ProcessingJob>(`/documents/processing/${jobId}`);
    },
    list() {
      return request<DocumentListResponse>("/documents");
    },
    get(documentId: string) {
      return request<DocumentDetailResponse>(`/documents/${documentId}`);
    },
    content(documentId: string) {
      return request<DocumentContentResponse>(`/documents/${documentId}/content`);
    },
    memories(documentId: string) {
      return request<DocumentMemoriesResponse>(`/documents/${documentId}/memories`);
    },
    remove(documentId: string) {
      return request<{ message: string; documentId: string }>(
        `/documents/${documentId}`,
        {
          method: "DELETE",
        }
      );
    },
  },
  reminders: {
    check() {
      return request<ReminderCheckResponse>("/reminders/check");
    },
    list(all = false) {
      return request<ReminderListResponse>(
        `/reminders${buildQuery({ all: all ? "true" : undefined })}`
      );
    },
    dismiss(reminderId: string) {
      return request<{ message: string; reminderId: string }>(
        `/reminders/${reminderId}/dismiss`,
        {
          method: "POST",
        }
      );
    },
    action(reminderId: string, action: ReminderAction, bucketIds?: string[]) {
      return request<{ message: string; reminderId: string; action: string }>(
        `/reminders/${reminderId}/action`,
        {
          method: "POST",
          body: { action, bucketIds },
        }
      );
    },
    contradictions() {
      return request<ContradictionListResponse>("/reminders/contradictions");
    },
    resolveContradiction(contradictionId: string) {
      return request<{ message: string; contradictionId: string }>(
        `/reminders/contradictions/${contradictionId}/resolve`,
        {
          method: "POST",
        }
      );
    },
  },
  settings: {
    get() {
      return request<Settings>("/settings");
    },
    update(params: SettingsUpdateParams) {
      return request<{ message: string; updated: Record<string, unknown> }>(
        "/settings",
        {
          method: "PATCH",
          body: params,
        }
      );
    },
  },
  export: {
    memories() {
      return request<Record<string, unknown>>("/export/memories");
    },
    conversations() {
      return request<Record<string, unknown>>("/export/conversations");
    },
    backup() {
      return request<BackupResponse>("/export/backup", {
        method: "POST",
      });
    },
    stats() {
      return request<ExportStatsResponse>("/export/stats");
    },
  },
  cortex: {
    async map(): Promise<CortexMapResponse> {
      const [documentsResponse, exportResponse] = await Promise.all([
        request<DocumentListResponse>("/documents"),
        request<{
          buckets?: CortexExportBucket[];
          relationships?: unknown;
        }>("/export/memories"),
      ]);

      const documents = documentsResponse.documents ?? [];
      const buckets = exportResponse.buckets ?? [];

      // FIX 1: normalize relationships so edges can never silently die.
      const rawRelationships = exportResponse.relationships;
      const relationships = normalizeExportRelationships(rawRelationships, buckets);
      if (
        Array.isArray(rawRelationships) &&
        rawRelationships.length > 0 &&
        relationships.length === 0
      ) {
        console.warn(
          "[cortex] /export/memories relationships could not be resolved against buckets:",
          rawRelationships.slice(0, 3)
        );
      }

      const documentMemories = await Promise.all(
        documents.map((document) =>
          request<DocumentMemoriesResponse>(`/documents/${document.documentId}/memories`).catch(
            (): DocumentMemoriesResponse => ({
              documentId: document.documentId,
              memories: [],
              count: 0,
            })
          )
        )
      );

      const bucketToDocuments: Record<string, string[]> = {};
      documentMemories.forEach((entry) => {
        for (const memory of entry.memories) {
          const existing = bucketToDocuments[memory.bucketId] ?? [];
          if (!existing.includes(entry.documentId)) {
            existing.push(entry.documentId);
          }
          bucketToDocuments[memory.bucketId] = existing;
        }
      });

      const bucketDocumentMap: Record<string, string | null> = {};
      for (const bucket of buckets) {
        const owners = bucketToDocuments[bucket.bucketId] ?? [];
        bucketDocumentMap[bucket.bucketId] = owners.length > 0 ? owners[0] : null;
      }

      const conceptDegree: Record<string, number> = {};
      for (const relationship of relationships) {
        conceptDegree[relationship.sourceBucket] =
          (conceptDegree[relationship.sourceBucket] ?? 0) + 1;
        conceptDegree[relationship.targetBucket] =
          (conceptDegree[relationship.targetBucket] ?? 0) + 1;
      }

      const pairShared = new Map<string, Set<string>>();
      const addPair = (documentA: string, documentB: string, bucketId: string) => {
        if (documentA === documentB) return;
        const key = [documentA, documentB].sort().join(":");
        const current = pairShared.get(key) ?? new Set<string>();
        current.add(bucketId);
        pairShared.set(key, current);
      };

      for (const [bucketId, owners] of Object.entries(bucketToDocuments)) {
        if (owners.length <= 1) continue;
        for (let i = 0; i < owners.length; i += 1) {
          for (let j = i + 1; j < owners.length; j += 1) {
            addPair(owners[i], owners[j], bucketId);
          }
        }
      }

      for (const relationship of relationships) {
        const sourceDocument = bucketDocumentMap[relationship.sourceBucket] ?? null;
        const targetDocument = bucketDocumentMap[relationship.targetBucket] ?? null;
        if (sourceDocument && targetDocument && sourceDocument !== targetDocument) {
          addPair(sourceDocument, targetDocument, relationship.sourceBucket);
        }
      }

      const documentById = new Map(documents.map((document) => [document.documentId, document]));
      const relatedByDocument = new Map<string, CortexRelatedDocument[]>();
      for (const [key, bucketIds] of pairShared.entries()) {
        const [documentA, documentB] = key.split(":");
        const metaA = documentById.get(documentA);
        const metaB = documentById.get(documentB);
        if (!metaA || !metaB) continue;
        const relatedForA = relatedByDocument.get(documentA) ?? [];
        relatedForA.push({
          documentId: documentB,
          filename: metaB.filename,
          sharedConcepts: bucketIds.size,
        });
        relatedByDocument.set(documentA, relatedForA);
        const relatedForB = relatedByDocument.get(documentB) ?? [];
        relatedForB.push({
          documentId: documentA,
          filename: metaA.filename,
          sharedConcepts: bucketIds.size,
        });
        relatedByDocument.set(documentB, relatedForB);
      }
      for (const related of relatedByDocument.values()) {
        related.sort((a, b) => b.sharedConcepts - a.sharedConcepts);
      }

      const bucketById = new Map(buckets.map((bucket) => [bucket.bucketId, bucket]));
      const documentNodes: CortexDocumentNode[] = documents.map((document, index) => {
        const documentBucketIds = new Set(
          documentMemories[index].memories.map((memory) => memory.bucketId)
        );
        let strengthSum = 0;
        let strengthCount = 0;
        let criticalCount = 0;
        let connectedConceptCount = 0;
        let isolatedConceptCount = 0;
        const topConcepts: Array<{
          bucketId: string;
          canonical: string;
          score: number;
        }> = [];
        for (const bucketId of documentBucketIds) {
          const bucket = bucketById.get(bucketId);
          if (!bucket) continue;
          strengthSum += bucket.strength;
          strengthCount += 1;
          if (bucket.category === "critical") {
            criticalCount += 1;
          }
          const degree = conceptDegree[bucketId] ?? 0;
          if (degree > 0) {
            connectedConceptCount += 1;
          } else {
            isolatedConceptCount += 1;
          }
          topConcepts.push({
            bucketId,
            canonical: bucket.canonical,
            score: bucket.importance * 10 + bucket.strength,
          });
        }
        topConcepts.sort((a, b) => b.score - a.score);
        const relatedDocuments = relatedByDocument.get(document.documentId) ?? [];
        return {
          documentId: document.documentId,
          filename: document.filename,
          fileType: document.fileType,
          uploadedAt: document.uploadedAt,
          conceptCount: documentBucketIds.size,
          averageStrength: strengthCount > 0 ? strengthSum / strengthCount : 0,
          criticalCount,
          connectedConceptCount,
          isolatedConceptCount,
          relatedDocuments,
          topConcepts: topConcepts.slice(0, 3).map((entry) => ({
            bucketId: entry.bucketId,
            canonical: entry.canonical,
          })),
          solo: relatedDocuments.length === 0,
        };
      });

      const concepts: CortexConcept[] = buckets.map((bucket) => ({
        bucketId: bucket.bucketId,
        canonical: bucket.canonical,
        strength: bucket.strength,
        category: bucket.category,
        importance: bucket.importance,
        conceptType: bucket.conceptType,
        lastAccessed: bucket.lastAccessed,
        accessCount: bucket.accessCount,
        daysSinceAccess: Math.max(
          0,
          (Date.now() - new Date(bucket.lastAccessed).getTime()) / 86400000
        ),
        createdAt: bucket.createdAt,
        documentId: bucketDocumentMap[bucket.bucketId] ?? null,
      }));

      const totalStrength = buckets.reduce((sum, bucket) => sum + bucket.strength, 0);
      const core: CortexCoreSummary = {
        totalMemories: buckets.length,
        averageStrength: buckets.length > 0 ? totalStrength / buckets.length : 0,
        criticalCount: buckets.filter((bucket) => bucket.category === "critical").length,
        documentCount: documents.length,
        totalRelationships: relationships.length,
      };

      return {
        core,
        documents: documentNodes,
        concepts,
        relationships,
        bucketDocumentMap,
        conceptDegree,
      };
    },
  },
  health: {
    check() {
      return request<HealthResponse>("/health", {
        auth: false,
      });
    },
  },
  demo: {
    startSandbox() {
      return request<{
        token: string;
        user: User;
        expiresAt: string;
        ttlMinutes: number;
      }>("/demo/start", { method: "POST", auth: false });
    },
  },
};
