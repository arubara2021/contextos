import { query, queryOne, queryMany, withTransaction } from "../database";
import {
  Relationship,
  RelationshipRow,
  RelationshipCreateParams,
  RelationshipWithMeta,
  RelationshipType,
  mapRowToRelationship,
  mapRowToRelationshipWithMeta,
  validateConfidence,
  RELATIONSHIP_TYPES,
} from "../models/relationship.model";
import { normalizeKey } from "./bucket-store";
import logger from "../utils/logger";

export type RelationshipMethod =
  | "exact"
  | "vector"
  | "extraction"
  | "ai"
  | "legacy";

export interface RelationshipMetadata {
  method?: RelationshipMethod;
  similarity?: number;
  sourceDocumentId?: string | null;
  targetDocumentId?: string | null;
  evidence?: string;
  updatedAt?: string;
}

type RelationshipCreateParamsExtended = RelationshipCreateParams & {
  sourceBucketId?: string | null;
  targetBucketId?: string | null;
  userId?: string | null;
  documentId?: string | null;
  sourceDocumentId?: string | null;
  targetDocumentId?: string | null;
  metadata?: RelationshipMetadata;
};

interface SyncEdgeInput {
  sourceBucketId?: string | null;
  targetBucketId?: string | null;
  sourceLabel?: string;
  targetLabel?: string;
  relationType?: RelationshipType;
  confidence?: number;
  sourceText?: string | null;
}

interface SyncFromConceptsInput {
  userId?: string | null;
  documentId?: string | null;
  edges: SyncEdgeInput[];
}

export interface VectorConnectionEdge {
  sourceBucketId: string;
  targetBucketId: string;
  sourceLabel?: string;
  targetLabel?: string;
  confidence: number;
  similarity?: number;
  sourceDocumentId?: string | null;
  targetDocumentId?: string | null;
  evidence?: string;
}

interface SyncVectorConnectionsInput {
  userId: string;
  documentId?: string | null;
  edges: VectorConnectionEdge[];
}

interface ExpandedEdge {
  sourceBucketId: string;
  targetBucketId: string;
  relationType: string;
  confidence: number;
}

export interface DocumentLinkInput {
  targetDocumentId: string;
  correlationScore: number;
  sharedBucketCount: number;
  edgeCount: number;
  avgConfidence: number;
}

export interface RelatedDocumentRow {
  documentId: string;
  filename: string;
  correlation: number;
  sharedConcepts: number;
  edges: number;
  avgConfidence: number;
}

export interface TopConnectedMemoryRow {
  bucketId: string;
  label: string;
  relationType: string;
  confidence: number;
  documentId: string | null;
}

export interface ConnectionStatsRow {
  exactMerges: number;
  semanticConnections: number;
  crossDocumentConnections: number;
  strongConnections: number;
  connectionScore: number;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
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

function sanitizeMetadata(
  metadata?: RelationshipMetadata | null
): RelationshipMetadata | null {
  if (!metadata) return null;
  const result: RelationshipMetadata = {};
  if (metadata.method) {
    result.method = metadata.method;
  }
  if (
    typeof metadata.similarity === "number" &&
    Number.isFinite(metadata.similarity)
  ) {
    result.similarity = clampUnit(metadata.similarity);
  }
  if (metadata.sourceDocumentId) {
    result.sourceDocumentId = metadata.sourceDocumentId;
  }
  if (metadata.targetDocumentId) {
    result.targetDocumentId = metadata.targetDocumentId;
  }
  if (metadata.evidence) {
    result.evidence = String(metadata.evidence).substring(0, 1000);
  }
  result.updatedAt = new Date().toISOString();
  return Object.keys(result).length > 0 ? result : null;
}

function normalizeDocumentLink(
  link: DocumentLinkInput,
  sourceDocumentId: string
): DocumentLinkInput | null {
  const targetDocumentId = String(link.targetDocumentId ?? "").trim();
  if (!isValidUuid(targetDocumentId)) {
    return null;
  }
  if (targetDocumentId === sourceDocumentId) {
    return null;
  }
  const edgeCount = nonNegativeInt(link.edgeCount);
  const sharedBucketCount = nonNegativeInt(link.sharedBucketCount);
  if (edgeCount <= 0 && sharedBucketCount <= 0) {
    return null;
  }
  return {
    targetDocumentId,
    correlationScore: round4(link.correlationScore),
    sharedBucketCount,
    edgeCount,
    avgConfidence: round4(link.avgConfidence),
  };
}

export class RelationshipStore {
  private normalizeRelationType(value: unknown): RelationshipType {
    if (typeof value !== "string") return "related_to";
    return (RELATIONSHIP_TYPES as string[]).includes(value)
      ? (value as RelationshipType)
      : "related_to";
  }

  private prepareMetadata(
    params: RelationshipCreateParamsExtended
  ): RelationshipMetadata | null {
    const base: RelationshipMetadata = { ...(params.metadata ?? {}) };
    if (params.sourceDocumentId) {
      base.sourceDocumentId = params.sourceDocumentId;
    }
    if (params.targetDocumentId) {
      base.targetDocumentId = params.targetDocumentId;
    }
    if (params.documentId && !base.sourceDocumentId) {
      base.sourceDocumentId = params.documentId;
    }
    return sanitizeMetadata(base);
  }

  async resolveBucketIdByCanonical(
    canonical: string,
    userId?: string | null,
    documentId?: string | null
  ): Promise<string | null> {
    if (!canonical || !canonical.trim()) return null;
    const normalized = normalizeKey(canonical);
    try {
      if (documentId && isValidUuid(documentId)) {
        const row = await queryOne<{ bucket_id: string }>(
          `SELECT bucket_id
           FROM buckets
           WHERE (canonical = $1 OR normalized = $2)
           AND document_id = $3::uuid
           ORDER BY strength DESC, last_accessed DESC
           LIMIT 1`,
          [canonical, normalized, documentId]
        );
        if (row?.bucket_id) return row.bucket_id;
      }

      if (userId && isValidUuid(userId)) {
        const userRow = await queryOne<{ bucket_id: string }>(
          `SELECT bucket_id
           FROM buckets
           WHERE (canonical = $1 OR normalized = $2)
           AND user_id = $3::uuid
           ORDER BY strength DESC, last_accessed DESC
           LIMIT 1`,
          [canonical, normalized, userId]
        );
        if (userRow?.bucket_id) return userRow.bucket_id;

        const nullRow = await queryOne<{ bucket_id: string }>(
          `SELECT bucket_id
           FROM buckets
           WHERE (canonical = $1 OR normalized = $2)
           AND user_id IS NULL
           ORDER BY strength DESC, last_accessed DESC
           LIMIT 1`,
          [canonical, normalized]
        );
        if (nullRow?.bucket_id) return nullRow.bucket_id;
        return null;
      }

      const nullRow = await queryOne<{ bucket_id: string }>(
        `SELECT bucket_id
         FROM buckets
         WHERE (canonical = $1 OR normalized = $2)
         AND user_id IS NULL
         ORDER BY strength DESC, last_accessed DESC
         LIMIT 1`,
        [canonical, normalized]
      );
      if (nullRow?.bucket_id) return nullRow.bucket_id;

      const anyRow = await queryOne<{ bucket_id: string }>(
        `SELECT bucket_id
         FROM buckets
         WHERE canonical = $1 OR normalized = $2
         ORDER BY strength DESC, last_accessed DESC
         LIMIT 1`,
        [canonical, normalized]
      );
      return anyRow?.bucket_id ?? null;
    } catch (error) {
      logger.error("resolveBucketIdByCanonical failed", {
        canonical,
        userId,
        documentId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  private async resolveBucketUserId(bucketId: string): Promise<string | null> {
    if (!isValidUuid(bucketId)) return null;
    try {
      const row = await queryOne<{ user_id: string | null }>(
        "SELECT user_id FROM buckets WHERE bucket_id = $1::uuid",
        [bucketId]
      );
      return row?.user_id ?? null;
    } catch {
      return null;
    }
  }

  private async resolveCanonical(bucketId: string): Promise<string | null> {
    if (!isValidUuid(bucketId)) return null;
    try {
      const row = await queryOne<{ canonical: string }>(
        "SELECT canonical FROM buckets WHERE bucket_id = $1::uuid",
        [bucketId]
      );
      return row?.canonical ?? null;
    } catch {
      return null;
    }
  }

  async createRelationship(
    params: RelationshipCreateParamsExtended
  ): Promise<string> {
    try {
      const relationType = this.normalizeRelationType(params.relationType);
      const confidence = validateConfidence(params.confidence ?? 0.5);

      let sourceBucketId = params.sourceBucketId ?? null;
      let targetBucketId = params.targetBucketId ?? null;
      let userId = params.userId ?? null;

      if (sourceBucketId && !isValidUuid(sourceBucketId)) {
        sourceBucketId = null;
      }
      if (targetBucketId && !isValidUuid(targetBucketId)) {
        targetBucketId = null;
      }
      if (userId && !isValidUuid(userId)) {
        userId = null;
      }

      if (!sourceBucketId) {
        sourceBucketId = await this.resolveBucketIdByCanonical(
          params.sourceBucket,
          userId,
          params.documentId
        );
      }
      if (!targetBucketId) {
        targetBucketId = await this.resolveBucketIdByCanonical(
          params.targetBucket,
          userId,
          params.documentId
        );
      }

      if (!userId && sourceBucketId) {
        userId = await this.resolveBucketUserId(sourceBucketId);
      }
      if (!userId && targetBucketId) {
        userId = await this.resolveBucketUserId(targetBucketId);
      }

      let sourceCanonical = params.sourceBucket;
      let targetCanonical = params.targetBucket;

      if (sourceBucketId && (!sourceCanonical || !sourceCanonical.trim())) {
        sourceCanonical = (await this.resolveCanonical(sourceBucketId)) ?? "";
      }
      if (targetBucketId && (!targetCanonical || !targetCanonical.trim())) {
        targetCanonical = (await this.resolveCanonical(targetBucketId)) ?? "";
      }

      if (!sourceCanonical || !targetCanonical) return "";
      if (normalizeKey(sourceCanonical) === normalizeKey(targetCanonical)) {
        return "";
      }

      const metadata = this.prepareMetadata(params);
      const metadataJson = metadata ? JSON.stringify(metadata) : null;

      if (sourceBucketId && targetBucketId) {
        const existing = userId
          ? await queryOne<{ relationship_id: string }>(
            `SELECT relationship_id
               FROM relationships
               WHERE source_bucket_id = $1::uuid
               AND target_bucket_id = $2::uuid
               AND relation_type = $3
               AND (user_id = $4::uuid OR user_id IS NULL)
               LIMIT 1`,
            [sourceBucketId, targetBucketId, relationType, userId]
          )
          : await queryOne<{ relationship_id: string }>(
            `SELECT relationship_id
               FROM relationships
               WHERE source_bucket_id = $1::uuid
               AND target_bucket_id = $2::uuid
               AND relation_type = $3
               AND user_id IS NULL
               LIMIT 1`,
            [sourceBucketId, targetBucketId, relationType]
          );

        if (existing) {
          await query(
            `UPDATE relationships
             SET confidence = GREATEST(confidence, $1),
                 source_bucket = $2,
                 target_bucket = $3,
                 user_id = COALESCE(user_id, $4::uuid),
                 source_text = COALESCE($5, source_text),
                 metadata = COALESCE(metadata, '{}'::jsonb) || COALESCE($6::jsonb, '{}'::jsonb)
             WHERE relationship_id = $7`,
            [
              confidence,
              sourceCanonical,
              targetCanonical,
              userId,
              params.sourceText ?? null,
              metadataJson,
              existing.relationship_id,
            ]
          );
          return existing.relationship_id;
        }

        const row = await queryOne<{ relationship_id: string }>(
          `INSERT INTO relationships (
            source_bucket,
            target_bucket,
            relation_type,
            confidence,
            source_text,
            source_bucket_id,
            target_bucket_id,
            user_id,
            metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::uuid, $8::uuid, $9::jsonb)
          ON CONFLICT (source_bucket, target_bucket, relation_type)
          DO UPDATE SET
            confidence = GREATEST(relationships.confidence, EXCLUDED.confidence),
            source_bucket_id = COALESCE(relationships.source_bucket_id, EXCLUDED.source_bucket_id),
            target_bucket_id = COALESCE(relationships.target_bucket_id, EXCLUDED.target_bucket_id),
            user_id = COALESCE(relationships.user_id, EXCLUDED.user_id),
            source_text = COALESCE(EXCLUDED.source_text, relationships.source_text),
            metadata = COALESCE(relationships.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
          RETURNING relationship_id`,
          [
            sourceCanonical,
            targetCanonical,
            relationType,
            confidence,
            params.sourceText ?? null,
            sourceBucketId,
            targetBucketId,
            userId,
            metadataJson,
          ]
        );
        return row?.relationship_id ?? "";
      }

      const row = await queryOne<{ relationship_id: string }>(
        `INSERT INTO relationships (
          source_bucket,
          target_bucket,
          relation_type,
          confidence,
          source_text,
          user_id,
          metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6::uuid, $7::jsonb)
        ON CONFLICT (source_bucket, target_bucket, relation_type)
        DO UPDATE SET
          confidence = GREATEST(relationships.confidence, EXCLUDED.confidence),
          user_id = COALESCE(relationships.user_id, EXCLUDED.user_id),
          source_text = COALESCE(EXCLUDED.source_text, relationships.source_text),
          metadata = COALESCE(relationships.metadata, '{}'::jsonb) || COALESCE(EXCLUDED.metadata, '{}'::jsonb)
        RETURNING relationship_id`,
        [
          sourceCanonical,
          targetCanonical,
          relationType,
          confidence,
          params.sourceText ?? null,
          userId,
          metadataJson,
        ]
      );
      return row?.relationship_id ?? "";
    } catch (error) {
      logger.error("createRelationship failed", {
        source: params.sourceBucket,
        target: params.targetBucket,
        type: params.relationType,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async syncFromConcepts(input: SyncFromConceptsInput): Promise<number> {
    if (!input.edges || input.edges.length === 0) return 0;
    let stored = 0;
    const seen = new Set<string>();

    for (const edge of input.edges) {
      try {
        let sourceBucketId = edge.sourceBucketId ?? null;
        let targetBucketId = edge.targetBucketId ?? null;

        if (sourceBucketId && !isValidUuid(sourceBucketId)) {
          sourceBucketId = null;
        }
        if (targetBucketId && !isValidUuid(targetBucketId)) {
          targetBucketId = null;
        }

        if (!sourceBucketId && edge.sourceLabel) {
          sourceBucketId = await this.resolveBucketIdByCanonical(
            edge.sourceLabel,
            input.userId,
            input.documentId
          );
        }
        if (!targetBucketId && edge.targetLabel) {
          targetBucketId = await this.resolveBucketIdByCanonical(
            edge.targetLabel,
            input.userId,
            input.documentId
          );
        }

        if (!sourceBucketId || !targetBucketId) continue;
        if (sourceBucketId === targetBucketId) continue;

        let userId = input.userId ?? null;
        if (userId && !isValidUuid(userId)) {
          userId = null;
        }
        if (!userId) {
          userId =
            (await this.resolveBucketUserId(sourceBucketId)) ??
            (await this.resolveBucketUserId(targetBucketId));
        }

        const sourceCanonical =
          edge.sourceLabel || (await this.resolveCanonical(sourceBucketId));
        const targetCanonical =
          edge.targetLabel || (await this.resolveCanonical(targetBucketId));
        if (!sourceCanonical || !targetCanonical) continue;

        const relationType = this.normalizeRelationType(edge.relationType);
        const key = `${userId ?? "null"}:${sourceBucketId}:${targetBucketId}:${relationType}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const relationshipId = await this.createRelationship({
          sourceBucket: sourceCanonical,
          targetBucket: targetCanonical,
          relationType,
          confidence: edge.confidence ?? 0.65,
          sourceText: edge.sourceText ?? undefined,
          sourceBucketId,
          targetBucketId,
          userId,
          documentId: input.documentId ?? null,
          sourceDocumentId: input.documentId ?? null,
          metadata: {
            method: "extraction",
            sourceDocumentId: input.documentId ?? null,
            evidence: edge.sourceText ?? undefined,
          },
        });
        if (relationshipId) stored++;
      } catch {
        continue;
      }
    }
    return stored;
  }

  async syncVectorConnections(
    input: SyncVectorConnectionsInput
  ): Promise<number> {
    if (!input.edges || input.edges.length === 0) return 0;
    if (!isValidUuid(input.userId)) return 0;
    let stored = 0;
    const seen = new Set<string>();

    for (const edge of input.edges) {
      try {
        if (
          !isValidUuid(edge.sourceBucketId) ||
          !isValidUuid(edge.targetBucketId)
        ) {
          continue;
        }
        if (edge.sourceBucketId === edge.targetBucketId) continue;

        const key = [edge.sourceBucketId, edge.targetBucketId].sort().join(":");
        if (seen.has(key)) continue;
        seen.add(key);

        const confidence = clampUnit(edge.confidence);
        const similarity = clampUnit(edge.similarity ?? confidence);

        const sourceCanonical =
          edge.sourceLabel || (await this.resolveCanonical(edge.sourceBucketId));
        const targetCanonical =
          edge.targetLabel || (await this.resolveCanonical(edge.targetBucketId));
        if (!sourceCanonical || !targetCanonical) continue;

        const evidence =
          edge.evidence ?? `${sourceCanonical} -> ${targetCanonical}`;
        const sourceDocumentId =
          edge.sourceDocumentId ?? input.documentId ?? null;
        const targetDocumentId = edge.targetDocumentId ?? null;

        const relationshipId = await this.createRelationship({
          sourceBucket: sourceCanonical,
          targetBucket: targetCanonical,
          relationType: "related_to",
          confidence,
          sourceText: evidence,
          sourceBucketId: edge.sourceBucketId,
          targetBucketId: edge.targetBucketId,
          userId: input.userId,
          documentId: input.documentId ?? null,
          sourceDocumentId,
          targetDocumentId,
          metadata: {
            method: "vector",
            similarity,
            sourceDocumentId,
            targetDocumentId,
            evidence,
          },
        });
        if (relationshipId) stored++;
      } catch {
        continue;
      }
    }
    return stored;
  }

  async clearDocumentLinks(
    userId: string,
    sourceDocumentId: string
  ): Promise<void> {
    if (!isValidUuid(userId) || !isValidUuid(sourceDocumentId)) return;
    try {
      await query(
        `DELETE FROM document_links
         WHERE user_id = $1::uuid
         AND source_document_id = $2::uuid`,
        [userId, sourceDocumentId]
      );
    } catch (error) {
      logger.warn("clearDocumentLinks failed", {
        userId,
        sourceDocumentId,
        error: (error as Error).message,
      });
    }
  }

  private async upsertDocumentLinkAbsolute(
    userId: string,
    sourceDocumentId: string,
    link: DocumentLinkInput
  ): Promise<boolean> {
    if (!isValidUuid(userId) || !isValidUuid(sourceDocumentId)) {
      return false;
    }
    if (!isValidUuid(link.targetDocumentId)) {
      return false;
    }
    if (link.targetDocumentId === sourceDocumentId) {
      return false;
    }

    try {
      await query(
        `INSERT INTO document_links (
          user_id,
          source_document_id,
          target_document_id,
          correlation_score,
          shared_bucket_count,
          edge_count,
          avg_confidence,
          updated_at
        )
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, now())
        ON CONFLICT (user_id, source_document_id, target_document_id)
        DO UPDATE SET
          correlation_score = EXCLUDED.correlation_score,
          shared_bucket_count = EXCLUDED.shared_bucket_count,
          edge_count = EXCLUDED.edge_count,
          avg_confidence = EXCLUDED.avg_confidence,
          updated_at = now()`,
        [
          userId,
          sourceDocumentId,
          link.targetDocumentId,
          round4(link.correlationScore),
          nonNegativeInt(link.sharedBucketCount),
          nonNegativeInt(link.edgeCount),
          round4(link.avgConfidence),
        ]
      );
      return true;
    } catch (error) {
      logger.debug("upsertDocumentLinkAbsolute failed", {
        userId,
        sourceDocumentId,
        targetDocumentId: link.targetDocumentId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  async saveDocumentLinks(
    userId: string,
    sourceDocumentId: string,
    links: DocumentLinkInput[]
  ): Promise<number> {
    if (!isValidUuid(userId) || !isValidUuid(sourceDocumentId)) return 0;
    if (!Array.isArray(links)) return 0;
    let saved = 0;
    for (const rawLink of links) {
      const link = normalizeDocumentLink(rawLink, sourceDocumentId);
      if (!link) continue;
      const ok = await this.upsertDocumentLinkAbsolute(
        userId,
        sourceDocumentId,
        link
      );
      if (ok) saved++;
    }
    return saved;
  }

  private async getExistingDocumentLinks(
    userId: string,
    sourceDocumentId: string
  ): Promise<Map<string, DocumentLinkInput>> {
    const result = new Map<string, DocumentLinkInput>();
    if (!isValidUuid(userId) || !isValidUuid(sourceDocumentId)) {
      return result;
    }
    try {
      const rows = await queryMany<{
        target_document_id: string;
        correlation_score: number;
        shared_bucket_count: number;
        edge_count: number;
        avg_confidence: number;
      }>(
        `SELECT target_document_id,
                correlation_score,
                shared_bucket_count,
                edge_count,
                avg_confidence
         FROM document_links
         WHERE user_id = $1::uuid
         AND source_document_id = $2::uuid`,
        [userId, sourceDocumentId]
      );
      for (const row of rows) {
        result.set(row.target_document_id, {
          targetDocumentId: row.target_document_id,
          correlationScore: round4(row.correlation_score),
          sharedBucketCount: nonNegativeInt(row.shared_bucket_count),
          edgeCount: nonNegativeInt(row.edge_count),
          avgConfidence: round4(row.avg_confidence),
        });
      }
    } catch (error) {
      logger.debug("getExistingDocumentLinks failed", {
        userId,
        sourceDocumentId,
        error: (error as Error).message,
      });
    }
    return result;
  }

  private mergeDocumentLink(
    existing: DocumentLinkInput | undefined,
    incoming: DocumentLinkInput
  ): DocumentLinkInput {
    if (!existing) {
      return incoming;
    }
    const edgeCount = existing.edgeCount + incoming.edgeCount;
    const avgConfidence =
      edgeCount > 0
        ? (existing.avgConfidence * existing.edgeCount +
          incoming.avgConfidence * incoming.edgeCount) /
        edgeCount
        : incoming.avgConfidence;

    return {
      targetDocumentId: incoming.targetDocumentId,
      correlationScore: round4(
        Math.max(existing.correlationScore, incoming.correlationScore)
      ),
      sharedBucketCount: Math.max(
        existing.sharedBucketCount,
        incoming.sharedBucketCount
      ),
      edgeCount,
      avgConfidence: round4(avgConfidence),
    };
  }

  async aggregateDocumentLinks(
    userId: string,
    documentId: string,
    options?: {
      links?: DocumentLinkInput[];
      topN?: number;
    }
  ): Promise<number> {
    if (!isValidUuid(userId) || !isValidUuid(documentId)) return 0;

    const incomingLinks: DocumentLinkInput[] = [];

    if (options?.links && options.links.length > 0) {
      for (const rawLink of options.links) {
        const link = normalizeDocumentLink(rawLink, documentId);
        if (link) incomingLinks.push(link);
      }
    } else {
      try {
        const rows = await queryMany<{
          other_document_id: string;
          edge_count: number;
          avg_confidence: number;
          shared_bucket_count: number;
        }>(
          `WITH meta_edges AS (
            SELECT NULLIF(metadata->>'sourceDocumentId', '') AS source_document_id,
                   NULLIF(metadata->>'targetDocumentId', '') AS target_document_id,
                   source_bucket_id,
                   confidence
            FROM relationships
            WHERE user_id = $1::uuid
            AND metadata IS NOT NULL
            AND NULLIF(metadata->>'sourceDocumentId', '') IS NOT NULL
            AND NULLIF(metadata->>'targetDocumentId', '') IS NOT NULL
            AND NULLIF(metadata->>'sourceDocumentId', '') <> NULLIF(metadata->>'targetDocumentId', '')
          ), normalized AS (
            SELECT CASE
                     WHEN source_document_id = $2::text THEN target_document_id
                     ELSE source_document_id
                   END AS other_document_id,
                   source_bucket_id,
                   confidence
            FROM meta_edges
            WHERE source_document_id = $2::text
               OR target_document_id = $2::text
          )
          SELECT n.other_document_id,
                 COUNT(*)::int AS edge_count,
                 COALESCE(AVG(n.confidence), 0)::float AS avg_confidence,
                 COUNT(DISTINCT n.source_bucket_id)::int AS shared_bucket_count
          FROM normalized n
          JOIN documents d ON d.document_id::text = n.other_document_id
          WHERE d.user_id = $1::uuid
          AND n.other_document_id IS NOT NULL
          AND n.other_document_id <> $2::text
          GROUP BY n.other_document_id`,
          [userId, documentId]
        );

        for (const row of rows) {
          const edgeCount = nonNegativeInt(row.edge_count);
          const avgConfidence = round4(row.avg_confidence);
          const correlationScore = round4(
            0.45 * avgConfidence +
            0.35 * Math.min(1, edgeCount / 5) +
            0.2 * Math.min(1, edgeCount / 10)
          );
          incomingLinks.push({
            targetDocumentId: row.other_document_id,
            correlationScore,
            sharedBucketCount: nonNegativeInt(row.shared_bucket_count),
            edgeCount,
            avgConfidence,
          });
        }
      } catch (error) {
        logger.error("aggregateDocumentLinks query failed", {
          userId,
          documentId,
          error: (error as Error).message,
        });
        return 0;
      }
    }

    if (incomingLinks.length === 0) {
      return 0;
    }

    const existingLinks = await this.getExistingDocumentLinks(
      userId,
      documentId
    );

    let saved = 0;
    for (const incoming of incomingLinks) {
      const existing = existingLinks.get(incoming.targetDocumentId);
      const merged = this.mergeDocumentLink(existing, incoming);
      const ok = await this.upsertDocumentLinkAbsolute(
        userId,
        documentId,
        merged
      );
      if (ok) saved++;
    }
    return saved;
  }

  async getRelatedDocuments(
    userId: string,
    documentId: string,
    limit?: number
  ): Promise<RelatedDocumentRow[]> {
    if (!isValidUuid(userId) || !isValidUuid(documentId)) return [];
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit ?? 10)));

    try {
      const rows = await queryMany<{
        document_id: string;
        filename: string;
        correlation: number;
        shared_concepts: number;
        edges: number;
        avg_confidence: number;
      }>(
        `WITH links AS (
          SELECT CASE
                   WHEN source_document_id = $2::uuid THEN target_document_id
                   ELSE source_document_id
                 END AS other_document_id,
                 correlation_score,
                 shared_bucket_count,
                 edge_count,
                 avg_confidence
          FROM document_links
          WHERE user_id = $1::uuid
          AND (source_document_id = $2::uuid OR target_document_id = $2::uuid)
        )
        SELECT links.other_document_id::text AS document_id,
               d.filename,
               MAX(links.correlation_score)::float AS correlation,
               MAX(links.shared_bucket_count)::int AS shared_concepts,
               MAX(links.edge_count)::int AS edges,
               MAX(links.avg_confidence)::float AS avg_confidence
        FROM links
        JOIN documents d ON d.document_id = links.other_document_id
        WHERE d.user_id = $1::uuid
        AND links.other_document_id <> $2::uuid
        GROUP BY links.other_document_id, d.filename
        ORDER BY correlation DESC, edges DESC
        LIMIT $3`,
        [userId, documentId, safeLimit]
      );

      return rows.map((row) => ({
        documentId: row.document_id,
        filename: row.filename,
        correlation: round4(row.correlation),
        sharedConcepts: nonNegativeInt(row.shared_concepts),
        edges: nonNegativeInt(row.edges),
        avgConfidence: round4(row.avg_confidence),
      }));
    } catch (error) {
      logger.error("getRelatedDocuments failed", {
        userId,
        documentId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async getTopConnectedMemories(
    userId: string,
    documentId: string,
    limit?: number
  ): Promise<TopConnectedMemoryRow[]> {
    if (!isValidUuid(userId) || !isValidUuid(documentId)) return [];
    const safeLimit = Math.max(1, Math.min(50, Math.floor(limit ?? 10)));

    try {
      const rows = await queryMany<{
        bucket_id: string;
        canonical: string;
        relation_type: string;
        confidence: number;
        document_id: string | null;
      }>(
        `SELECT l.connected_bucket_id AS bucket_id,
                b.canonical,
                l.relation_type,
                MAX(l.confidence)::float AS confidence,
                b.document_id
         FROM (
           SELECT CASE
                    WHEN NULLIF(metadata->>'sourceDocumentId', '') = $2::text
                    THEN target_bucket_id
                    ELSE source_bucket_id
                  END AS connected_bucket_id,
                  relation_type,
                  confidence
           FROM relationships
           WHERE user_id = $1::uuid
           AND metadata IS NOT NULL
           AND (
             NULLIF(metadata->>'sourceDocumentId', '') = $2::text
             OR NULLIF(metadata->>'targetDocumentId', '') = $2::text
           )
         ) l
         JOIN buckets b ON b.bucket_id = l.connected_bucket_id
         WHERE l.connected_bucket_id IS NOT NULL
         AND (b.document_id IS NULL OR b.document_id::text <> $2::text)
         GROUP BY l.connected_bucket_id, b.canonical, l.relation_type, b.document_id
         ORDER BY confidence DESC
         LIMIT $3`,
        [userId, documentId, safeLimit * 2]
      );

      const deduped = new Map<string, TopConnectedMemoryRow>();
      for (const row of rows) {
        const existing = deduped.get(row.bucket_id);
        if (!existing || Number(row.confidence) > existing.confidence) {
          deduped.set(row.bucket_id, {
            bucketId: row.bucket_id,
            label: row.canonical,
            relationType: row.relation_type,
            confidence: round4(row.confidence),
            documentId: row.document_id,
          });
        }
      }
      return Array.from(deduped.values()).slice(0, safeLimit);
    } catch (error) {
      logger.error("getTopConnectedMemories failed", {
        userId,
        documentId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async getConnectionStats(
    userId: string,
    documentId: string,
    exactMerges: number = 0
  ): Promise<ConnectionStatsRow> {
    const exact = Math.max(0, Math.round(exactMerges));

    if (!isValidUuid(userId) || !isValidUuid(documentId)) {
      return {
        exactMerges: exact,
        semanticConnections: 0,
        crossDocumentConnections: 0,
        strongConnections: 0,
        connectionScore: round4(exact > 0 ? 0.35 : 0),
      };
    }

    try {
      const strongThreshold = 0.75;
      const row = await queryOne<{
        semantic: number;
        cross_document: number;
        strong: number;
        avg_confidence: number;
      }>(
        `WITH doc_edges AS (
          SELECT confidence,
                 NULLIF(metadata->>'sourceDocumentId', '') AS src_doc,
                 NULLIF(metadata->>'targetDocumentId', '') AS tgt_doc,
                 COALESCE(metadata->>'method', '') AS method
          FROM relationships
          WHERE user_id = $1::uuid
          AND metadata IS NOT NULL
          AND (
            NULLIF(metadata->>'sourceDocumentId', '') = $2::text
            OR NULLIF(metadata->>'targetDocumentId', '') = $2::text
          )
        )
        SELECT COALESCE(SUM(CASE WHEN method IN ('vector', 'ai') THEN 1 ELSE 0 END), 0)::int AS semantic,
               COALESCE(SUM(CASE WHEN method IN ('vector', 'ai') AND src_doc IS NOT NULL AND tgt_doc IS NOT NULL AND src_doc <> tgt_doc THEN 1 ELSE 0 END), 0)::int AS cross_document,
               COALESCE(SUM(CASE WHEN method IN ('vector', 'ai') AND confidence >= $3 THEN 1 ELSE 0 END), 0)::int AS strong,
               COALESCE(AVG(CASE WHEN method IN ('vector', 'ai') THEN confidence END), 0)::float AS avg_confidence
        FROM doc_edges`,
        [userId, documentId, strongThreshold]
      );

      const semantic = nonNegativeInt(row?.semantic);
      const cross = nonNegativeInt(row?.cross_document);
      const strong = nonNegativeInt(row?.strong);
      const avg = round4(row?.avg_confidence);

      const exactRate = Math.min(1, exact / 2);
      const semanticRate = Math.min(1, semantic / 5);
      const crossRate = Math.min(1, cross / 5);

      let connectionScore =
        0.45 * exactRate +
        0.3 * semanticRate +
        0.15 * crossRate +
        0.1 * avg;

      if (exact > 0 && connectionScore < 0.35) {
        connectionScore = 0.35;
      }

      return {
        exactMerges: exact,
        semanticConnections: semantic,
        crossDocumentConnections: cross,
        strongConnections: strong,
        connectionScore: round4(connectionScore),
      };
    } catch (error) {
      logger.error("getConnectionStats failed", {
        userId,
        documentId,
        error: (error as Error).message,
      });
      return {
        exactMerges: exact,
        semanticConnections: 0,
        crossDocumentConnections: 0,
        strongConnections: 0,
        connectionScore: round4(exact > 0 ? 0.35 : 0),
      };
    }
  }

  async expandFromBucketIds(
    bucketIds: string[],
    userId?: string | null,
    limit: number = 40
  ): Promise<ExpandedEdge[]> {
    const safeBucketIds = (bucketIds || []).filter(isValidUuid);
    if (safeBucketIds.length === 0) return [];
    const safeUserId = userId && isValidUuid(userId) ? userId : null;
    const results: ExpandedEdge[] = [];
    const seen = new Set<string>();

    try {
      const idRows = safeUserId
        ? await queryMany<{
          source_bucket_id: string | null;
          target_bucket_id: string | null;
          relation_type: string;
          confidence: number;
        }>(
          `SELECT source_bucket_id, target_bucket_id, relation_type, confidence
             FROM relationships
             WHERE (source_bucket_id = ANY($1::uuid[]) OR target_bucket_id = ANY($1::uuid[]))
             AND source_bucket_id IS NOT NULL
             AND target_bucket_id IS NOT NULL
             AND (user_id = $2::uuid OR user_id IS NULL)
             ORDER BY confidence DESC
             LIMIT $3`,
          [safeBucketIds, safeUserId, limit * 2]
        )
        : await queryMany<{
          source_bucket_id: string | null;
          target_bucket_id: string | null;
          relation_type: string;
          confidence: number;
        }>(
          `SELECT source_bucket_id, target_bucket_id, relation_type, confidence
             FROM relationships
             WHERE (source_bucket_id = ANY($1::uuid[]) OR target_bucket_id = ANY($1::uuid[]))
             AND source_bucket_id IS NOT NULL
             AND target_bucket_id IS NOT NULL
             ORDER BY confidence DESC
             LIMIT $2`,
          [safeBucketIds, limit * 2]
        );

      for (const row of idRows) {
        if (!row.source_bucket_id || !row.target_bucket_id) continue;
        const key = `${row.source_bucket_id}:${row.target_bucket_id}:${row.relation_type}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          sourceBucketId: row.source_bucket_id,
          targetBucketId: row.target_bucket_id,
          relationType: row.relation_type,
          confidence: Number(row.confidence),
        });
      }
    } catch (error) {
      logger.debug("ID-based expansion failed", {
        error: (error as Error).message,
      });
    }

    try {
      const canonicalRows = await queryMany<{
        bucket_id: string;
        canonical: string;
      }>(
        `SELECT bucket_id, canonical
         FROM buckets
         WHERE bucket_id = ANY($1::uuid[])`,
        [safeBucketIds]
      );

      const canonicals = canonicalRows.map((r) => r.canonical);

      if (canonicals.length > 0) {
        const fallbackRows = safeUserId
          ? await queryMany<{
            source_bucket_id: string | null;
            target_bucket_id: string | null;
            relation_type: string;
            confidence: number;
          }>(
            `SELECT r.source_bucket_id,
                      r.target_bucket_id,
                      r.relation_type,
                      r.confidence
               FROM relationships r
               JOIN buckets b1 ON b1.canonical = r.source_bucket
               JOIN buckets b2 ON b2.canonical = r.target_bucket
               WHERE (r.source_bucket = ANY($1::text[]) OR r.target_bucket = ANY($1::text[]))
               AND (r.source_bucket_id IS NULL OR r.target_bucket_id IS NULL)
               AND (b1.user_id = $2::uuid OR b1.user_id IS NULL)
               AND (b2.user_id = $2::uuid OR b2.user_id IS NULL)
               ORDER BY r.confidence DESC
               LIMIT $3`,
            [canonicals, safeUserId, limit * 2]
          )
          : await queryMany<{
            source_bucket_id: string | null;
            target_bucket_id: string | null;
            relation_type: string;
            confidence: number;
          }>(
            `SELECT r.source_bucket_id,
                      r.target_bucket_id,
                      r.relation_type,
                      r.confidence
               FROM relationships r
               JOIN buckets b1 ON b1.canonical = r.source_bucket
               JOIN buckets b2 ON b2.canonical = r.target_bucket
               WHERE (r.source_bucket = ANY($1::text[]) OR r.target_bucket = ANY($1::text[]))
               AND (r.source_bucket_id IS NULL OR r.target_bucket_id IS NULL)
               ORDER BY r.confidence DESC
               LIMIT $2`,
            [canonicals, limit * 2]
          );

        for (const row of fallbackRows) {
          if (!row.source_bucket_id || !row.target_bucket_id) continue;
          const key = `${row.source_bucket_id}:${row.target_bucket_id}:${row.relation_type}`;
          if (seen.has(key)) continue;
          seen.add(key);
          results.push({
            sourceBucketId: row.source_bucket_id,
            targetBucketId: row.target_bucket_id,
            relationType: row.relation_type,
            confidence: Number(row.confidence),
          });
        }
      }
    } catch (error) {
      logger.debug("Canonical fallback expansion failed", {
        error: (error as Error).message,
      });
    }

    return results.slice(0, limit);
  }

  async getRelationshipsFrom(
    bucketId: string,
    userId?: string | null
  ): Promise<RelationshipWithMeta[]> {
    if (!isValidUuid(bucketId)) return [];
    const safeUserId = userId && isValidUuid(userId) ? userId : null;

    try {
      const idRows = safeUserId
        ? await queryMany<
          RelationshipRow & {
            connected_bucket_id: string;
            connected_bucket_name: string;
            connected_bucket_type: string;
          }
        >(
          `SELECT r.*,
                    b.bucket_id AS connected_bucket_id,
                    b.canonical AS connected_bucket_name,
                    b.concept_type AS connected_bucket_type
             FROM relationships r
             JOIN buckets b ON b.bucket_id = r.target_bucket_id
             WHERE r.source_bucket_id = $1::uuid
             AND (r.user_id = $2::uuid OR r.user_id IS NULL)
             ORDER BY r.confidence DESC`,
          [bucketId, safeUserId]
        )
        : await queryMany<
          RelationshipRow & {
            connected_bucket_id: string;
            connected_bucket_name: string;
            connected_bucket_type: string;
          }
        >(
          `SELECT r.*,
                    b.bucket_id AS connected_bucket_id,
                    b.canonical AS connected_bucket_name,
                    b.concept_type AS connected_bucket_type
             FROM relationships r
             JOIN buckets b ON b.bucket_id = r.target_bucket_id
             WHERE r.source_bucket_id = $1::uuid
             ORDER BY r.confidence DESC`,
          [bucketId]
        );

      if (idRows.length > 0) {
        return idRows.map((row) =>
          mapRowToRelationshipWithMeta(
            {
              ...row,
              source_bucket: bucketId,
              target_bucket: row.connected_bucket_id,
            } as any,
            bucketId
          )
        );
      }

      const sourceRow = await queryOne<{ canonical: string }>(
        "SELECT canonical FROM buckets WHERE bucket_id = $1::uuid",
        [bucketId]
      );
      if (!sourceRow) return [];

      const rows = safeUserId
        ? await queryMany<
          RelationshipRow & {
            connected_bucket_id: string;
            connected_bucket_name: string;
            connected_bucket_type: string;
          }
        >(
          `SELECT r.*,
                    b.bucket_id AS connected_bucket_id,
                    b.canonical AS connected_bucket_name,
                    b.concept_type AS connected_bucket_type
             FROM relationships r
             JOIN buckets b ON b.canonical = r.target_bucket
             WHERE r.source_bucket = $1
             AND (b.user_id = $2::uuid OR b.user_id IS NULL)
             ORDER BY r.confidence DESC`,
          [sourceRow.canonical, safeUserId]
        )
        : await queryMany<
          RelationshipRow & {
            connected_bucket_id: string;
            connected_bucket_name: string;
            connected_bucket_type: string;
          }
        >(
          `SELECT r.*,
                    b.bucket_id AS connected_bucket_id,
                    b.canonical AS connected_bucket_name,
                    b.concept_type AS connected_bucket_type
             FROM relationships r
             JOIN buckets b ON b.canonical = r.target_bucket
             WHERE r.source_bucket = $1
             ORDER BY r.confidence DESC`,
          [sourceRow.canonical]
        );

      return rows.map((row) =>
        mapRowToRelationshipWithMeta(
          {
            ...row,
            source_bucket: bucketId,
            target_bucket: row.connected_bucket_id,
          } as any,
          bucketId
        )
      );
    } catch (error) {
      logger.error("getRelationshipsFrom failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getRelationshipsTo(
    bucketId: string,
    userId?: string | null
  ): Promise<RelationshipWithMeta[]> {
    if (!isValidUuid(bucketId)) return [];
    const safeUserId = userId && isValidUuid(userId) ? userId : null;

    try {
      const idRows = safeUserId
        ? await queryMany<
          RelationshipRow & {
            connected_bucket_id: string;
            connected_bucket_name: string;
            connected_bucket_type: string;
          }
        >(
          `SELECT r.*,
                    b.bucket_id AS connected_bucket_id,
                    b.canonical AS connected_bucket_name,
                    b.concept_type AS connected_bucket_type
             FROM relationships r
             JOIN buckets b ON b.bucket_id = r.source_bucket_id
             WHERE r.target_bucket_id = $1::uuid
             AND (r.user_id = $2::uuid OR r.user_id IS NULL)
             ORDER BY r.confidence DESC`,
          [bucketId, safeUserId]
        )
        : await queryMany<
          RelationshipRow & {
            connected_bucket_id: string;
            connected_bucket_name: string;
            connected_bucket_type: string;
          }
        >(
          `SELECT r.*,
                    b.bucket_id AS connected_bucket_id,
                    b.canonical AS connected_bucket_name,
                    b.concept_type AS connected_bucket_type
             FROM relationships r
             JOIN buckets b ON b.bucket_id = r.source_bucket_id
             WHERE r.target_bucket_id = $1::uuid
             ORDER BY r.confidence DESC`,
          [bucketId]
        );

      if (idRows.length > 0) {
        return idRows.map((row) =>
          mapRowToRelationshipWithMeta(
            {
              ...row,
              source_bucket: row.connected_bucket_id,
              target_bucket: bucketId,
            } as any,
            bucketId
          )
        );
      }

      const targetRow = await queryOne<{ canonical: string }>(
        "SELECT canonical FROM buckets WHERE bucket_id = $1::uuid",
        [bucketId]
      );
      if (!targetRow) return [];

      const rows = safeUserId
        ? await queryMany<
          RelationshipRow & {
            connected_bucket_id: string;
            connected_bucket_name: string;
            connected_bucket_type: string;
          }
        >(
          `SELECT r.*,
                    b.bucket_id AS connected_bucket_id,
                    b.canonical AS connected_bucket_name,
                    b.concept_type AS connected_bucket_type
             FROM relationships r
             JOIN buckets b ON b.canonical = r.source_bucket
             WHERE r.target_bucket = $1
             AND (b.user_id = $2::uuid OR b.user_id IS NULL)
             ORDER BY r.confidence DESC`,
          [targetRow.canonical, safeUserId]
        )
        : await queryMany<
          RelationshipRow & {
            connected_bucket_id: string;
            connected_bucket_name: string;
            connected_bucket_type: string;
          }
        >(
          `SELECT r.*,
                    b.bucket_id AS connected_bucket_id,
                    b.canonical AS connected_bucket_name,
                    b.concept_type AS connected_bucket_type
             FROM relationships r
             JOIN buckets b ON b.canonical = r.source_bucket
             WHERE r.target_bucket = $1
             ORDER BY r.confidence DESC`,
          [targetRow.canonical]
        );

      return rows.map((row) =>
        mapRowToRelationshipWithMeta(
          {
            ...row,
            source_bucket: row.connected_bucket_id,
            target_bucket: bucketId,
          } as any,
          bucketId
        )
      );
    } catch (error) {
      logger.error("getRelationshipsTo failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getAllConnected(
    bucketId: string,
    userId?: string | null
  ): Promise<RelationshipWithMeta[]> {
    try {
      const [outgoing, incoming] = await Promise.all([
        this.getRelationshipsFrom(bucketId, userId),
        this.getRelationshipsTo(bucketId, userId),
      ]);

      const seen = new Set<string>();
      const merged: RelationshipWithMeta[] = [];

      for (const rel of outgoing) {
        if (!seen.has(rel.relationshipId)) {
          seen.add(rel.relationshipId);
          merged.push(rel);
        }
      }
      for (const rel of incoming) {
        if (!seen.has(rel.relationshipId)) {
          seen.add(rel.relationshipId);
          merged.push(rel);
        }
      }
      return merged;
    } catch (error) {
      logger.error("getAllConnected failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getMultiHop(
    startBucketIds: string[],
    maxHops: number = 2,
    userId?: string | null
  ): Promise<Relationship[]> {
    const safeStartIds = (startBucketIds || []).filter(isValidUuid);
    if (safeStartIds.length === 0) return [];
    if (maxHops < 1) return [];

    const visited = new Set<string>(safeStartIds);
    let currentLevel = new Set<string>(safeStartIds);
    const allRelationships: Relationship[] = [];

    for (let hop = 0; hop < maxHops; hop++) {
      const nextLevel = new Set<string>();
      const edges = await this.expandFromBucketIds(
        Array.from(currentLevel),
        userId,
        100
      );

      for (const edge of edges) {
        allRelationships.push({
          relationshipId: `${edge.sourceBucketId}:${edge.targetBucketId}:${edge.relationType}`,
          sourceBucket: edge.sourceBucketId,
          targetBucket: edge.targetBucketId,
          relationType: edge.relationType as RelationshipType,
          confidence: edge.confidence,
          sourceText: null,
        } as Relationship);

        const other = currentLevel.has(edge.sourceBucketId)
          ? edge.targetBucketId
          : edge.sourceBucketId;
        if (!visited.has(other)) {
          visited.add(other);
          nextLevel.add(other);
        }
      }

      currentLevel = nextLevel;
      if (currentLevel.size === 0) break;
    }

    return this.deduplicateRelationships(allRelationships);
  }

  async strengthenCoAccess(bucketIds: string[]): Promise<number> {
    const safeBucketIds = (bucketIds || []).filter(isValidUuid);
    if (safeBucketIds.length < 2) return 0;
    let updated = 0;

    for (let i = 0; i < safeBucketIds.length; i++) {
      for (let j = i + 1; j < safeBucketIds.length; j++) {
        try {
          const result = await query(
            `UPDATE relationships
             SET confidence = LEAST(1.0, confidence + 0.05)
             WHERE (source_bucket_id = $1::uuid AND target_bucket_id = $2::uuid)
                OR (source_bucket_id = $2::uuid AND target_bucket_id = $1::uuid)`,
            [safeBucketIds[i], safeBucketIds[j]]
          );
          updated += result.rowCount ?? 0;
        } catch { }
      }
    }

    const canonicalMap = new Map<string, string>();
    for (const bucketId of safeBucketIds) {
      try {
        const row = await queryOne<{ canonical: string }>(
          "SELECT canonical FROM buckets WHERE bucket_id = $1::uuid",
          [bucketId]
        );
        if (row) canonicalMap.set(bucketId, row.canonical);
      } catch { }
    }

    const resolvedIds = Array.from(canonicalMap.keys());
    for (let i = 0; i < resolvedIds.length; i++) {
      for (let j = i + 1; j < resolvedIds.length; j++) {
        const canonA = canonicalMap.get(resolvedIds[i])!;
        const canonB = canonicalMap.get(resolvedIds[j])!;
        try {
          const result = await query(
            `UPDATE relationships
             SET confidence = LEAST(1.0, confidence + 0.05)
             WHERE (source_bucket = $1 AND target_bucket = $2)
                OR (source_bucket = $2 AND target_bucket = $1)`,
            [canonA, canonB]
          );
          updated += result.rowCount ?? 0;
        } catch { }
      }
    }

    return updated;
  }

  async getTotalCount(userId?: string | null): Promise<number> {
    try {
      const row =
        userId && isValidUuid(userId)
          ? await queryOne<{ count: number }>(
            "SELECT COUNT(*)::int AS count FROM relationships WHERE user_id = $1::uuid",
            [userId]
          )
          : await queryOne<{ count: number }>(
            "SELECT COUNT(*)::int AS count FROM relationships"
          );
      return row?.count ?? 0;
      return row?.count ?? 0;
    } catch (error) {
      logger.error("getTotalCount failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getCountByType(): Promise<Record<string, number>> {
    try {
      const rows = await queryMany<{ relation_type: string; count: number }>(
        "SELECT relation_type, COUNT(*)::int AS count FROM relationships GROUP BY relation_type"
      );
      const result: Record<string, number> = {};
      for (const row of rows) {
        result[row.relation_type] = row.count;
      }
      return result;
    } catch (error) {
      logger.error("getCountByType failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async cleanupOrphaned(): Promise<number> {
    try {
      const result = await query(
        `DELETE FROM relationships
         WHERE (source_bucket_id IS NOT NULL AND source_bucket_id NOT IN (SELECT bucket_id FROM buckets))
            OR (target_bucket_id IS NOT NULL AND target_bucket_id NOT IN (SELECT bucket_id FROM buckets))
            OR (source_bucket_id IS NULL AND source_bucket NOT IN (SELECT canonical FROM buckets))
            OR (target_bucket_id IS NULL AND target_bucket NOT IN (SELECT canonical FROM buckets))`
      );
      const deleted = result.rowCount ?? 0;
      if (deleted > 0) {
        logger.info("Cleaned up orphaned relationships", { deleted });
      }
      return deleted;
    } catch (error) {
      logger.error("cleanupOrphaned failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async deleteByBucket(bucketId: string): Promise<number> {
    if (!isValidUuid(bucketId)) return 0;
    try {
      const canonicalRow = await queryOne<{ canonical: string }>(
        "SELECT canonical FROM buckets WHERE bucket_id = $1::uuid",
        [bucketId]
      );

      if (!canonicalRow) {
        const result = await query(
          `DELETE FROM relationships
           WHERE source_bucket_id = $1::uuid
              OR target_bucket_id = $1::uuid`,
          [bucketId]
        );
        return result.rowCount ?? 0;
      }

      const result = await query(
        `DELETE FROM relationships
         WHERE source_bucket_id = $1::uuid
            OR target_bucket_id = $1::uuid
            OR source_bucket = $2
            OR target_bucket = $2`,
        [bucketId, canonicalRow.canonical]
      );
      return result.rowCount ?? 0;
    } catch (error) {
      logger.error("deleteByBucket failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async deleteRelationship(relationshipId: string): Promise<void> {
    try {
      await query(
        "DELETE FROM relationships WHERE relationship_id = $1",
        [relationshipId]
      );
    } catch (error) {
      logger.error("deleteRelationship failed", {
        relationshipId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getByType(
    relationType: RelationshipType,
    limit: number = 50
  ): Promise<Relationship[]> {
    try {
      const rows = await queryMany<RelationshipRow>(
        "SELECT * FROM relationships WHERE relation_type = $1 ORDER BY confidence DESC LIMIT $2",
        [relationType, limit]
      );
      return rows.map(mapRowToRelationship);
    } catch (error) {
      logger.error("getByType failed", {
        relationType,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getAll(userId?: string | null): Promise<Relationship[]> {
    try {
      const rows =
        userId && isValidUuid(userId)
          ? await queryMany<RelationshipRow>(
            "SELECT * FROM relationships WHERE user_id = $1::uuid ORDER BY created_at DESC",
            [userId]
          )
          : await queryMany<RelationshipRow>(
            "SELECT * FROM relationships ORDER BY created_at DESC"
          );
      return rows.map(mapRowToRelationship);
    } catch (error) {
      logger.error("getAll failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async batchCreate(
    paramsList: RelationshipCreateParamsExtended[]
  ): Promise<number> {
    if (paramsList.length === 0) return 0;
    let created = 0;
    try {
      await withTransaction(async () => {
        for (const params of paramsList) {
          try {
            const id = await this.createRelationship(params);
            if (id) created++;
          } catch { }
        }
      });
    } catch (error) {
      logger.error("batchCreate transaction failed", {
        total: paramsList.length,
        created,
        error: (error as Error).message,
      });
      throw error;
    }
    return created;
  }

  private deduplicateRelationships(
    relationships: Relationship[]
  ): Relationship[] {
    const seen = new Set<string>();
    const deduplicated: Relationship[] = [];
    for (const rel of relationships) {
      const key = `${rel.sourceBucket}:${rel.targetBucket}:${rel.relationType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduplicated.push(rel);
    }
    return deduplicated;
  }
}

let relationshipStoreInstance: RelationshipStore | null = null;

export function getRelationshipStore(): RelationshipStore {
  if (!relationshipStoreInstance) {
    relationshipStoreInstance = new RelationshipStore();
  }
  return relationshipStoreInstance;
}