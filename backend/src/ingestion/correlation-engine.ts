import config from "../config";
import logger from "../utils/logger";
import { queryMany } from "../database";
import {
  EmbeddingStore,
  getEmbeddingStore,
} from "../storage/embedding-store";
import {
  RelationshipStore,
  getRelationshipStore,
  type DocumentLinkInput,
  type RelatedDocumentRow,
  type TopConnectedMemoryRow,
  type ConnectionStatsRow,
  type VectorConnectionEdge,
} from "../storage/relationship-store";

export interface CorrelationConceptInput {
  label: string;
  embedding?: number[] | null;
}

export interface CorrelationParams {
  userId: string;
  documentId: string;
  concepts: CorrelationConceptInput[];
  bucketIdByLabel: Map<string, string>;
  mergedBucketIds?: string[];
  exactMerges?: number;
}

export interface CorrelationResult {
  connections: ConnectionStatsRow;
  relatedDocuments: RelatedDocumentRow[];
  topConnectedMemories: TopConnectedMemoryRow[];
  edgesStored: number;
}

interface CorrelationConfig {
  enabled: boolean;
  minSimilarity: number;
  strongSimilarity: number;
  maxLinksPerConcept: number;
  maxEdgesPerDocument: number;
  documentTopN: number;
}

interface SourceEntry {
  label: string;
  bucketId: string;
  embedding: number[];
}

interface BucketMeta {
  label: string;
  documentId: string | null;
}

interface TargetDocumentStat {
  documentId: string;
  edgeCount: number;
  sumConfidence: number;
  shared: Set<string>;
}

interface ExactMergeOutcome {
  crossExactMerges: number;
  exactTop: TopConnectedMemoryRow[];
  exactRelated: RelatedDocumentRow[];
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampUnit(value: unknown): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function round4(value: unknown): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return 0;
  return Math.round(Math.max(0, Math.min(1, num)) * 10000) / 10000;
}

function nonNegativeInt(value: unknown): number {
  const num = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
}

function deserializeVector(raw: string): number[] {
  const cleaned = raw.replace(/^\[|\]$/g, "");
  return cleaned.split(",").map((s) => parseFloat(s.trim()));
}

function averageVectors(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dimension = vectors[0].length;
  if (!dimension) return null;
  const sum = new Array<number>(dimension).fill(0);
  let count = 0;
  for (const vector of vectors) {
    if (!Array.isArray(vector) || vector.length !== dimension) continue;
    let valid = true;
    for (let i = 0; i < dimension; i++) {
      if (!Number.isFinite(vector[i])) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    for (let i = 0; i < dimension; i++) {
      sum[i] += vector[i];
    }
    count++;
  }
  if (count === 0) return null;
  return sum.map((value) => value / count);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) return 0;
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return clampUnit(dot / (Math.sqrt(normA) * Math.sqrt(normB)));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection++;
  }
  const union = new Set([...a, ...b]).size;
  if (union === 0) return 0;
  return clampUnit(intersection / union);
}

export class CorrelationEngine {
  private readonly embeddingStore: EmbeddingStore;
  private readonly relationshipStore: RelationshipStore;

  constructor(deps?: {
    embeddingStore?: EmbeddingStore;
    relationshipStore?: RelationshipStore;
  }) {
    this.embeddingStore = deps?.embeddingStore ?? getEmbeddingStore();
    this.relationshipStore = deps?.relationshipStore ?? getRelationshipStore();
  }

  async run(params: CorrelationParams): Promise<CorrelationResult> {
    const cfg = this.getCorrelationConfig();
    const inputExactMerges = Math.max(0, Math.round(params.exactMerges ?? 0));

    if (!params.userId || !params.documentId) {
      return { ...this.emptyResult(inputExactMerges), edgesStored: 0 };
    }

    if (!isValidUuid(params.userId) || !isValidUuid(params.documentId)) {
      return { ...this.emptyResult(inputExactMerges), edgesStored: 0 };
    }

    if (!cfg.enabled) {
      return {
        connections: {
          exactMerges: inputExactMerges,
          semanticConnections: 0,
          crossDocumentConnections: 0,
          strongConnections: 0,
          connectionScore: clampUnit(inputExactMerges > 0 ? 0.25 : 0),
        },
        relatedDocuments: [],
        topConnectedMemories: [],
        edgesStored: 0,
      };
    }

    try {
      await this.relationshipStore
        .clearDocumentLinks(params.userId, params.documentId)
        .catch(() => undefined);

      const exact = await this.processExactMerges(params);
      const effectiveExactMerges =
        exact.crossExactMerges > 0 ? exact.crossExactMerges : inputExactMerges;

      const sourceEntries = this.buildSourceEntries(params);
      let edgesStored = 0;
      let edges: VectorConnectionEdge[] = [];

      if (sourceEntries.length > 0) {
        const candidateEdges = await this.collectVectorEdges(
          params,
          sourceEntries,
          cfg
        );
        edges = candidateEdges.slice(0, cfg.maxEdgesPerDocument);

        if (edges.length > 0) {
          edgesStored = await this.relationshipStore.syncVectorConnections({
            userId: params.userId,
            documentId: params.documentId,
            edges,
          });
        }

        const currentCentroid = averageVectors(
          sourceEntries.map((entry) => entry.embedding)
        );
        const currentLabels = new Set(
          sourceEntries
            .map((entry) => normalizeLabel(entry.label))
            .filter((label) => label.length > 0)
        );

        const links = await this.buildDocumentLinks(
          params,
          sourceEntries,
          edges,
          currentCentroid,
          currentLabels,
          cfg
        );

        if (links.length > 0) {
          await this.relationshipStore.aggregateDocumentLinks(
            params.userId,
            params.documentId,
            { links }
          );
        } else {
          await this.relationshipStore
            .aggregateDocumentLinks(params.userId, params.documentId)
            .catch(() => 0);
        }
      } else {
        await this.relationshipStore
          .aggregateDocumentLinks(params.userId, params.documentId)
          .catch(() => 0);
      }

      const [stats, relatedDocuments, topConnectedMemories] = await Promise.all([
        this.relationshipStore.getConnectionStats(
          params.userId,
          params.documentId,
          effectiveExactMerges
        ),
        this.relationshipStore.getRelatedDocuments(
          params.userId,
          params.documentId,
          cfg.documentTopN
        ),
        this.relationshipStore.getTopConnectedMemories(
          params.userId,
          params.documentId,
          cfg.documentTopN
        ),
      ]);

      const mergedRelated = this.mergeRelatedDocuments(
        relatedDocuments,
        exact.exactRelated
      );
      const mergedTop = this.mergeTopConnectedMemories(
        topConnectedMemories,
        exact.exactTop,
        cfg.documentTopN
      );

      return {
        connections: stats,
        relatedDocuments: mergedRelated,
        topConnectedMemories: mergedTop,
        edgesStored,
      };
    } catch (error) {
      logger.warn("Correlation engine failed", {
        userId: params.userId,
        documentId: params.documentId,
        error: (error as Error).message,
      });
      return { ...this.emptyResult(inputExactMerges), edgesStored: 0 };
    }
  }

  private getCorrelationConfig(): CorrelationConfig {
    const c = (config as any).correlation ?? {};
    const enabled =
      typeof c.enabled === "boolean"
        ? c.enabled
        : String(c.enabled ?? "true").toLowerCase() !== "false";
    return {
      enabled,
      minSimilarity: clampUnit(Number(c.minSimilarity ?? 0.7)),
      strongSimilarity: clampUnit(Number(c.strongSimilarity ?? 0.8)),
      maxLinksPerConcept: Math.max(
        1,
        Math.floor(Number(c.maxLinksPerConcept ?? 5))
      ),
      maxEdgesPerDocument: Math.max(
        1,
        Math.floor(Number(c.maxEdgesPerDocument ?? 150))
      ),
      documentTopN: Math.max(1, Math.floor(Number(c.documentTopN ?? 10))),
    };
  }

  private emptyResult(exactMerges: number): CorrelationResult {
    return {
      connections: {
        exactMerges,
        semanticConnections: 0,
        crossDocumentConnections: 0,
        strongConnections: 0,
        connectionScore: clampUnit(exactMerges > 0 ? 0.25 : 0),
      },
      relatedDocuments: [],
      topConnectedMemories: [],
      edgesStored: 0,
    };
  }

  private async processExactMerges(
    params: CorrelationParams
  ): Promise<ExactMergeOutcome> {
    const mergedBucketIds = (params.mergedBucketIds ?? []).filter(isValidUuid);
    if (mergedBucketIds.length === 0) {
      return { crossExactMerges: 0, exactTop: [], exactRelated: [] };
    }

    try {
      const mergedMeta = await queryMany<{
        bucket_id: string;
        canonical: string;
        document_id: string | null;
      }>(
        `SELECT bucket_id, canonical, document_id
         FROM buckets
         WHERE bucket_id = ANY($1::uuid[]) AND user_id = $2::uuid`,
        [mergedBucketIds, params.userId]
      );

      const targetMap = new Map<string, Set<string>>();
      const memoryMap = new Map<string, { label: string; documentId: string }>();

      for (const row of mergedMeta) {
        if (!row.document_id || row.document_id === params.documentId) continue;
        if (!isValidUuid(row.document_id)) continue;
        if (!targetMap.has(row.document_id)) {
          targetMap.set(row.document_id, new Set<string>());
        }
        targetMap.get(row.document_id)!.add(row.bucket_id);
        memoryMap.set(row.bucket_id, {
          label: row.canonical,
          documentId: row.document_id,
        });
      }

      const crossExactMerges = memoryMap.size;

      const exactTop: TopConnectedMemoryRow[] = Array.from(
        memoryMap.entries()
      ).map(([bucketId, meta]) => ({
        bucketId,
        label: meta.label,
        relationType: "shared_memory",
        confidence: 0.95,
        documentId: meta.documentId,
      }));

      const exactLinks: DocumentLinkInput[] = [];
      for (const [targetDocumentId, bucketSet] of targetMap.entries()) {
        const count = bucketSet.size;
        const correlationScore = round4(
          clampUnit(
            0.55 + Math.min(0.3, count * 0.1) + Math.min(0.1, count / 10)
          )
        );
        exactLinks.push({
          targetDocumentId,
          correlationScore,
          sharedBucketCount: count,
          edgeCount: count,
          avgConfidence: 0.95,
        });
      }

      if (exactLinks.length > 0) {
        await this.relationshipStore
          .saveDocumentLinks(params.userId, params.documentId, exactLinks)
          .catch(() => 0);
      }

      const exactRelated = await this.buildRelatedDocumentsFromLinks(
        params.userId,
        exactLinks
      );

      return { crossExactMerges, exactTop, exactRelated };
    } catch (error) {
      logger.debug("processExactMerges failed", {
        userId: params.userId,
        documentId: params.documentId,
        error: (error as Error).message,
      });
      return { crossExactMerges: 0, exactTop: [], exactRelated: [] };
    }
  }

  private async buildRelatedDocumentsFromLinks(
    userId: string,
    links: DocumentLinkInput[]
  ): Promise<RelatedDocumentRow[]> {
    const targetIds = Array.from(
      new Set(links.map((link) => link.targetDocumentId).filter(isValidUuid))
    );
    if (targetIds.length === 0) return [];

    try {
      const rows = await queryMany<{ document_id: string; filename: string }>(
        `SELECT document_id, filename
         FROM documents
         WHERE document_id = ANY($1::uuid[]) AND user_id = $2::uuid`,
        [targetIds, userId]
      );
      const filenameMap = new Map(
        rows.map((row) => [row.document_id, row.filename])
      );
      return links
        .filter((link) => filenameMap.has(link.targetDocumentId))
        .map((link) => ({
          documentId: link.targetDocumentId,
          filename: filenameMap.get(link.targetDocumentId) ?? "Unknown document",
          correlation: round4(link.correlationScore),
          sharedConcepts: nonNegativeInt(link.sharedBucketCount),
          edges: nonNegativeInt(link.edgeCount),
          avgConfidence: round4(link.avgConfidence),
        }))
        .sort((a, b) => b.correlation - a.correlation || b.edges - a.edges)
        .slice(0, 20);
    } catch {
      return [];
    }
  }

  private mergeRelatedDocuments(
    primary: RelatedDocumentRow[],
    fallback: RelatedDocumentRow[]
  ): RelatedDocumentRow[] {
    const map = new Map<string, RelatedDocumentRow>();
    for (const row of primary) {
      map.set(row.documentId, { ...row });
    }
    for (const row of fallback) {
      const existing = map.get(row.documentId);
      if (!existing) {
        map.set(row.documentId, { ...row });
        continue;
      }
      existing.correlation = Math.max(existing.correlation, row.correlation);
      existing.sharedConcepts = Math.max(
        existing.sharedConcepts,
        row.sharedConcepts
      );
      existing.edges = Math.max(existing.edges, row.edges);
      if (row.avgConfidence !== undefined) {
        existing.avgConfidence = Math.max(
          existing.avgConfidence ?? 0,
          row.avgConfidence
        );
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.correlation - a.correlation || b.edges - a.edges)
      .slice(0, 20);
  }

  private mergeTopConnectedMemories(
    vectorTop: TopConnectedMemoryRow[],
    exactTop: TopConnectedMemoryRow[],
    limit: number
  ): TopConnectedMemoryRow[] {
    const map = new Map<string, TopConnectedMemoryRow>();
    for (const memory of exactTop) {
      map.set(memory.bucketId, memory);
    }
    for (const memory of vectorTop) {
      const existing = map.get(memory.bucketId);
      if (!existing || memory.confidence > existing.confidence) {
        map.set(memory.bucketId, memory);
      }
    }
    return Array.from(map.values())
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);
  }

  private buildSourceEntries(params: CorrelationParams): SourceEntry[] {
    const entries: SourceEntry[] = [];
    const seen = new Set<string>();
    for (const concept of params.concepts) {
      const label = String(concept.label || "").trim();
      if (!label) continue;
      const bucketId = params.bucketIdByLabel.get(normalizeLabel(label));
      if (!bucketId) continue;
      const embedding = concept.embedding;
      if (!this.isValidEmbedding(embedding)) continue;
      if (seen.has(bucketId)) continue;
      seen.add(bucketId);
      entries.push({
        label,
        bucketId,
        embedding: embedding as number[],
      });
    }
    return entries;
  }

  private isValidEmbedding(embedding: number[] | null | undefined): boolean {
    if (!Array.isArray(embedding)) return false;
    if (embedding.length !== config.embedding.dimension) return false;
    let nonZero = false;
    for (const value of embedding) {
      if (!Number.isFinite(value)) return false;
      if (value !== 0) nonZero = true;
    }
    return nonZero;
  }

  private async collectVectorEdges(
    params: CorrelationParams,
    sourceEntries: SourceEntry[],
    cfg: CorrelationConfig
  ): Promise<VectorConnectionEdge[]> {
    const edges: VectorConnectionEdge[] = [];
    const seen = new Set<string>();
    const metaCache = new Map<string, BucketMeta>();

    for (const entry of sourceEntries) {
      if (edges.length >= cfg.maxEdgesPerDocument) break;

      let similar: Array<{ bucketId: string; similarity: number }> = [];
      try {
        similar = await this.embeddingStore.searchSimilarForCorrelation(
          entry.embedding,
          {
            userId: params.userId,
            excludeDocumentId: params.documentId,
            excludeBucketIds: [entry.bucketId],
            threshold: cfg.minSimilarity,
            limit: cfg.maxLinksPerConcept * 3 + 5,
          }
        );
      } catch (error) {
        logger.debug("Correlation vector search failed", {
          label: entry.label,
          error: (error as Error).message,
        });
        continue;
      }

      const candidates = similar
        .filter(
          (row) =>
            row &&
            typeof row.bucketId === "string" &&
            row.bucketId !== entry.bucketId &&
            Number(row.similarity) >= cfg.minSimilarity
        )
        .sort((a, b) => Number(b.similarity) - Number(a.similarity))
        .slice(0, cfg.maxLinksPerConcept);

      if (candidates.length === 0) continue;

      const missingIds = candidates
        .map((candidate) => candidate.bucketId)
        .filter((bucketId) => !metaCache.has(bucketId));

      if (missingIds.length > 0) {
        const meta = await this.loadBucketMeta(params.userId, missingIds);
        for (const [bucketId, value] of meta.entries()) {
          metaCache.set(bucketId, value);
        }
      }

      for (const candidate of candidates) {
        if (edges.length >= cfg.maxEdgesPerDocument) break;
        const targetMeta = metaCache.get(candidate.bucketId);
        if (!targetMeta) continue;
        if (targetMeta.documentId === params.documentId) continue;
        const edgeKey = [entry.bucketId, candidate.bucketId].sort().join(":");
        if (seen.has(edgeKey)) continue;
        seen.add(edgeKey);
        const confidence = clampUnit(candidate.similarity);
        edges.push({
          sourceBucketId: entry.bucketId,
          targetBucketId: candidate.bucketId,
          sourceLabel: entry.label,
          targetLabel: targetMeta.label,
          confidence,
          similarity: confidence,
          sourceDocumentId: params.documentId,
          targetDocumentId: targetMeta.documentId,
          evidence: `${entry.label} -> ${targetMeta.label}`,
        });
      }
    }

    return edges;
  }

  private async loadBucketMeta(
    userId: string,
    bucketIds: string[]
  ): Promise<Map<string, BucketMeta>> {
    const result = new Map<string, BucketMeta>();
    if (bucketIds.length === 0) return result;
    try {
      const rows = await queryMany<{
        bucket_id: string;
        canonical: string;
        document_id: string | null;
      }>(
        `SELECT bucket_id, canonical, document_id
         FROM buckets
         WHERE bucket_id = ANY($1::uuid[]) AND user_id = $2`,
        [bucketIds, userId]
      );
      for (const row of rows) {
        result.set(row.bucket_id, {
          label: row.canonical,
          documentId: row.document_id,
        });
      }
    } catch (error) {
      logger.debug("loadBucketMeta failed", {
        userId,
        count: bucketIds.length,
        error: (error as Error).message,
      });
    }
    return result;
  }

  private async buildDocumentLinks(
    params: CorrelationParams,
    sourceEntries: SourceEntry[],
    edges: VectorConnectionEdge[],
    currentCentroid: number[] | null,
    currentLabels: Set<string>,
    cfg: CorrelationConfig
  ): Promise<DocumentLinkInput[]> {
    const targetDocs = this.groupTargetDocuments(params.documentId, edges);
    if (targetDocs.size === 0) return [];

    const topTargets = Array.from(targetDocs.values())
      .sort((a, b) => {
        const avgA = a.edgeCount > 0 ? a.sumConfidence / a.edgeCount : 0;
        const avgB = b.edgeCount > 0 ? b.sumConfidence / b.edgeCount : 0;
        return avgB - avgA || b.edgeCount - a.edgeCount;
      })
      .slice(0, cfg.documentTopN);

    const links: DocumentLinkInput[] = [];
    for (const target of topTargets) {
      const [targetCentroid, targetLabels] = await Promise.all([
        this.getDocumentCentroid(params.userId, target.documentId),
        this.getDocumentLabels(params.userId, target.documentId),
      ]);

      const avgConfidence = clampUnit(
        target.edgeCount > 0 ? target.sumConfidence / target.edgeCount : 0
      );
      const centroidSimilarity =
        currentCentroid && targetCentroid
          ? cosineSimilarity(currentCentroid, targetCentroid)
          : null;
      const sharedConceptJaccard = jaccardSimilarity(currentLabels, targetLabels);
      const crossEdgeDensity = Math.min(
        1,
        target.edgeCount /
          Math.max(1, Math.min(sourceEntries.length, Math.max(1, targetLabels.size)))
      );

      const correlationScore =
        centroidSimilarity === null
          ? clampUnit(
              0.55 * avgConfidence +
                0.25 * sharedConceptJaccard +
                0.2 * crossEdgeDensity
            )
          : clampUnit(
              0.45 * centroidSimilarity +
                0.35 * sharedConceptJaccard +
                0.2 * crossEdgeDensity
            );

      links.push({
        targetDocumentId: target.documentId,
        correlationScore,
        sharedBucketCount: target.shared.size,
        edgeCount: target.edgeCount,
        avgConfidence,
      });
    }

    return links;
  }

  private groupTargetDocuments(
    sourceDocumentId: string,
    edges: VectorConnectionEdge[]
  ): Map<string, TargetDocumentStat> {
    const result = new Map<string, TargetDocumentStat>();
    for (const edge of edges) {
      const targetDocumentId = edge.targetDocumentId;
      if (!targetDocumentId || targetDocumentId === sourceDocumentId) continue;
      const existing = result.get(targetDocumentId) ?? {
        documentId: targetDocumentId,
        edgeCount: 0,
        sumConfidence: 0,
        shared: new Set<string>(),
      };
      existing.edgeCount++;
      existing.sumConfidence += clampUnit(edge.confidence);
      existing.shared.add(edge.sourceBucketId);
      result.set(targetDocumentId, existing);
    }
    return result;
  }

  private async getDocumentCentroid(
    userId: string,
    documentId: string
  ): Promise<number[] | null> {
    try {
      const rows = await queryMany<{ vector: string }>(
        `SELECT e.vector::text AS vector
         FROM embeddings e
         JOIN buckets b ON b.bucket_id = e.bucket_id
         WHERE b.user_id = $1 AND b.document_id = $2
         ORDER BY b.strength DESC, b.importance DESC
         LIMIT 100`,
        [userId, documentId]
      );
      const vectors: number[][] = [];
      for (const row of rows) {
        const vector = deserializeVector(row.vector);
        if (vector.length === config.embedding.dimension) {
          vectors.push(vector);
        }
      }
      return averageVectors(vectors);
    } catch (error) {
      logger.debug("getDocumentCentroid failed", {
        userId,
        documentId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async getDocumentLabels(
    userId: string,
    documentId: string
  ): Promise<Set<string>> {
    try {
      const rows = await queryMany<{ canonical: string }>(
        `SELECT canonical
         FROM buckets
         WHERE user_id = $1 AND document_id = $2
         ORDER BY strength DESC, importance DESC
         LIMIT 200`,
        [userId, documentId]
      );
      return new Set(
        rows
          .map((row) => normalizeLabel(row.canonical))
          .filter((label) => label.length > 0)
      );
    } catch (error) {
      logger.debug("getDocumentLabels failed", {
        userId,
        documentId,
        error: (error as Error).message,
      });
      return new Set();
    }
  }
}

let correlationEngineInstance: CorrelationEngine | null = null;

export function getCorrelationEngine(deps?: {
  embeddingStore?: EmbeddingStore;
  relationshipStore?: RelationshipStore;
}): CorrelationEngine {
  if (!correlationEngineInstance) {
    correlationEngineInstance = new CorrelationEngine(deps);
  }
  return correlationEngineInstance;
}

export async function runCorrelation(
  params: CorrelationParams
): Promise<CorrelationResult> {
  return getCorrelationEngine().run(params);
}