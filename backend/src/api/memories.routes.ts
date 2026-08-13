import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../auth/middleware";
import { getDependencies } from "./dependencies";
import { isConceptType } from "../models/concept.model";
import type { ConceptType } from "../models/concept.model";
import type { BucketUpdateParams } from "../models/bucket.model";
import { queryOne, queryMany } from "../database";
import logger from "../utils/logger";

const router = Router();

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

interface MemoryConnectionRow {
  connectedBucketId: string | null;
  label: string;
  relationType: string;
  confidence: number;
  documentId: string | null;
  documentFilename: string | null;
  method: string | null;
}

async function getMemoryConnections(
  bucketId: string,
  userId: string,
  canonical: string
): Promise<MemoryConnectionRow[]> {
  try {
    const rows = await queryMany<any>(
      `SELECT r.relation_type,
              r.confidence,
              r.metadata,
              CASE
                WHEN r.source_bucket_id = $1 THEN r.target_bucket_id
                ELSE r.source_bucket_id
              END AS connected_bucket_id,
              b.canonical AS connected_label,
              b.document_id AS connected_document_id,
              d.filename AS connected_document_filename
       FROM relationships r
       JOIN buckets b
         ON b.bucket_id = CASE
           WHEN r.source_bucket_id = $1 THEN r.target_bucket_id
           ELSE r.source_bucket_id
         END
       LEFT JOIN documents d
         ON d.document_id = b.document_id
       WHERE (r.source_bucket_id = $1 OR r.target_bucket_id = $1)
         AND r.source_bucket_id IS NOT NULL
         AND r.target_bucket_id IS NOT NULL
         AND (r.user_id = $2 OR r.user_id IS NULL)
         AND b.user_id = $2
       ORDER BY r.confidence DESC
       LIMIT 50`,
      [bucketId, userId]
    );

    if (rows.length > 0) {
      return rows.map((row) => ({
        connectedBucketId: row.connected_bucket_id ?? null,
        label: row.connected_label ?? "",
        relationType: row.relation_type ?? "related_to",
        confidence: clampUnit(row.confidence),
        documentId: row.connected_document_id ?? null,
        documentFilename: row.connected_document_filename ?? null,
        method: row.metadata?.method ?? null,
      }));
    }
  } catch (error) {
    logger.debug("ID-based memory connections failed", {
      bucketId,
      userId,
      error: (error as Error).message,
    });
  }

  try {
    const rows = await queryMany<any>(
      `SELECT r.relation_type,
              r.confidence,
              CASE
                WHEN r.source_bucket = $3 THEN r.target_bucket
                ELSE r.source_bucket
              END AS connected_label,
              b.bucket_id AS connected_bucket_id,
              b.document_id AS connected_document_id,
              d.filename AS connected_document_filename
       FROM relationships r
       JOIN buckets b
         ON b.canonical = CASE
           WHEN r.source_bucket = $3 THEN r.target_bucket
           ELSE r.source_bucket
         END
       LEFT JOIN documents d
         ON d.document_id = b.document_id
       WHERE (r.source_bucket = $3 OR r.target_bucket = $3)
         AND CASE
           WHEN r.source_bucket = $3 THEN r.target_bucket
           ELSE r.source_bucket
         END <> $3
         AND (r.user_id = $2 OR r.user_id IS NULL)
         AND b.user_id = $2
       ORDER BY r.confidence DESC
       LIMIT 50`,
      [bucketId, userId, canonical]
    );

    return rows.map((row) => ({
      connectedBucketId: row.connected_bucket_id ?? null,
      label: row.connected_label ?? "",
      relationType: row.relation_type ?? "related_to",
      confidence: clampUnit(row.confidence),
      documentId: row.connected_document_id ?? null,
      documentFilename: row.connected_document_filename ?? null,
      method: null,
    }));
  } catch (error) {
    logger.debug("Canonical memory connections failed", {
      bucketId,
      userId,
      error: (error as Error).message,
    });

    return [];
  }
}

function computeMemoryConnectivity(
  connections: MemoryConnectionRow[],
  ownDocumentId: string | null
): {
  score: number;
  degree: number;
  crossDocumentDegree: number;
  avgConfidence: number;
} {
  const connectedBucketIds = new Set(
    connections
      .map((c) => c.connectedBucketId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );

  const crossDocumentIds = new Set(
    connections
      .filter(
        (c) =>
          typeof c.documentId === "string" &&
          c.documentId.length > 0 &&
          c.documentId !== ownDocumentId
      )
      .map((c) => c.documentId as string)
  );

  const degree = connectedBucketIds.size;
  const crossDocumentDegree = crossDocumentIds.size;

  const avgConfidence =
    connections.length > 0
      ? connections.reduce((sum, c) => sum + clampUnit(c.confidence), 0) /
      connections.length
      : 0;

  const score =
    0.5 * Math.min(1, degree / 10) +
    0.3 * Math.min(1, crossDocumentDegree / 5) +
    0.2 * avgConfidence;

  return {
    score: round4(score),
    degree,
    crossDocumentDegree,
    avgConfidence: round4(avgConfidence),
  };
}

function buildConnectedDocuments(
  connections: MemoryConnectionRow[],
  ownDocumentId: string | null
): Array<{
  documentId: string;
  filename: string;
  edges: number;
  avgConfidence: number;
}> {
  const grouped = new Map<
    string,
    {
      documentId: string;
      filename: string;
      edges: number;
      confidenceSum: number;
    }
  >();

  for (const connection of connections) {
    const documentId = connection.documentId;

    if (!documentId || documentId === ownDocumentId) continue;

    const filename = connection.documentFilename ?? "Unknown document";
    const existing = grouped.get(documentId);

    if (existing) {
      existing.edges += 1;
      existing.confidenceSum += clampUnit(connection.confidence);
    } else {
      grouped.set(documentId, {
        documentId,
        filename,
        edges: 1,
        confidenceSum: clampUnit(connection.confidence),
      });
    }
  }

  return Array.from(grouped.values())
    .map((item) => ({
      documentId: item.documentId,
      filename: item.filename,
      edges: item.edges,
      avgConfidence: round4(
        item.edges > 0 ? item.confidenceSum / item.edges : 0
      ),
    }))
    .sort((a, b) => b.edges - a.edges || b.avgConfidence - a.avgConfidence)
    .slice(0, 10);
}

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { bucketStore, strengthTracker } = getDependencies();

    const conceptType =
      typeof req.query.type === "string" ? req.query.type : undefined;

    const minStrength = req.query.minStrength
      ? Number(req.query.minStrength)
      : undefined;

    const maxStrength = req.query.maxStrength
      ? Number(req.query.maxStrength)
      : undefined;

    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;

    const documentId =
      typeof req.query.documentId === "string" ? req.query.documentId : undefined;

    const limit = req.query.limit ? Math.min(Number(req.query.limit), 200) : 50;
    const offset = req.query.offset ? Number(req.query.offset) : 0;

    if (conceptType && !isConceptType(conceptType)) {
      res.status(400).json({
        error: "Invalid concept type",
        validTypes: [
          "problem",
          "decision",
          "fact",
          "entity",
          "event",
          "preference",
          "code",
        ],
      });
      return;
    }

    const buckets = await bucketStore.getAllBuckets(
      {
        conceptType: conceptType as any,
        minStrength,
        maxStrength,
        search,
        documentId,
        limit,
        offset,
      },
      req.userId
    );

    const enriched = buckets.map((bucket) => {
      const status = strengthTracker.getStatus({
        bucketId: bucket.bucketId,
        canonical: bucket.canonical,
        strength: bucket.strength,
        decayRate: bucket.decayRate,
        importance: bucket.importance,
        lastAccessed: bucket.lastAccessed,
        accessCount: bucket.accessCount,
      });

      return {
        bucketId: bucket.bucketId,
        canonical: bucket.canonical,
        strength: status.currentStrength,
        category: status.category,
        importance: bucket.importance,
        conceptType: bucket.conceptType,
        lastAccessed: bucket.lastAccessed.toISOString(),
        accessCount: bucket.accessCount,
        daysSinceAccess: status.daysSinceAccess,
        createdAt: bucket.createdAt.toISOString(),
      };
    });

    const totalCount = await bucketStore.getTotalCount(req.userId);

    res.status(200).json({
      memories: enriched,
      count: enriched.length,
      total: totalCount,
      offset,
      limit,
    });
  } catch (error) {
    logger.error("GET /memories failed", {
      error: (error as Error).message,
    });

    res.status(500).json({ error: "Failed to retrieve memories" });
  }
});

router.get("/stats", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { bucketStore, relationshipStore, rawStore, strengthTracker } =
      getDependencies();

    const [
      categories,
      byType,
      totalBuckets,
      totalRelationships,
      totalMessages,
      totalSessions,
    ] = await Promise.all([
      bucketStore.countByCategory(req.userId),
      bucketStore.countByType(req.userId),
      bucketStore.getTotalCount(req.userId),
      relationshipStore.getTotalCount(req.userId),
      rawStore.getTotalMessages(req.userId),
      rawStore.getTotalSessions(req.userId),
    ]);

    const averageStrength = await strengthTracker.bulkStatus();

    res.status(200).json({
      totalBuckets,
      strongCount: categories.strong,
      fadingCount: categories.fading,
      criticalCount: categories.critical,
      forgottenCount: categories.forgotten,
      totalRelationships,
      totalMessages,
      totalSessions,
      averageStrength: averageStrength.summary.averageStrength,
      bucketsByType: byType,
    });
  } catch (error) {
    logger.error("GET /memories/stats failed", {
      error: (error as Error).message,
    });

    res.status(500).json({ error: "Failed to retrieve memory stats" });
  }
});

router.get(
  "/:bucketId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { bucketId } = req.params;

      if (!bucketId) {
        res.status(400).json({ error: "bucketId is required" });
        return;
      }

      const { bucketStore, relationshipStore, strengthTracker } = getDependencies();

      const bucketWithItems = await bucketStore.getBucketById(bucketId, req.userId);

      if (!bucketWithItems) {
        res.status(404).json({ error: "Memory not found" });
        return;
      }

      const bucketMeta = await queryOne<{ document_id: string | null }>(
        `SELECT document_id
         FROM buckets
         WHERE bucket_id = $1 AND user_id = $2`,
        [bucketId, req.userId]
      );

      const ownDocumentId = bucketMeta?.document_id ?? null;

      const relationships = await relationshipStore.getAllConnected(
        bucketId,
        req.userId
      );

      const connections = await getMemoryConnections(
        bucketId,
        req.userId,
        bucketWithItems.bucket.canonical
      );

      const connectivity = computeMemoryConnectivity(connections, ownDocumentId);
      const connectedDocuments = buildConnectedDocuments(connections, ownDocumentId);

      const status = strengthTracker.getStatus({
        bucketId: bucketWithItems.bucket.bucketId,
        canonical: bucketWithItems.bucket.canonical,
        strength: bucketWithItems.bucket.strength,
        decayRate: bucketWithItems.bucket.decayRate,
        importance: bucketWithItems.bucket.importance,
        lastAccessed: bucketWithItems.bucket.lastAccessed,
        accessCount: bucketWithItems.bucket.accessCount,
      });

      const decayCurve = await strengthTracker.getDecayCurveForBucket(bucketId, 30);

      res.status(200).json({
        bucket: {
          bucketId: bucketWithItems.bucket.bucketId,
          canonical: bucketWithItems.bucket.canonical,
          strength: status.currentStrength,
          category: status.category,
          importance: bucketWithItems.bucket.importance,
          conceptType: bucketWithItems.bucket.conceptType,
          lastAccessed: bucketWithItems.bucket.lastAccessed.toISOString(),
          accessCount: bucketWithItems.bucket.accessCount,
          daysSinceAccess: status.daysSinceAccess,
          createdAt: bucketWithItems.bucket.createdAt.toISOString(),
          documentId: ownDocumentId,
        },
        items: bucketWithItems.items.map((item) => ({
          itemId: item.itemId,
          label: item.label,
          definition: item.definition,
          source: item.source,
          timestamp: item.timestamp.toISOString(),
        })),
        relationships: relationships.map((rel) => ({
          relationshipId: rel.relationshipId,
          connectedBucketId: rel.connectedBucketId,
          connectedBucketName: rel.connectedBucketName,
          relationType: rel.relationType,
          confidence: rel.confidence,
          direction: rel.direction,
        })),
        connections,
        connectivity,
        connectedDocuments,
        decayCurve,
      });
    } catch (error) {
      logger.error("GET /memories/:bucketId failed", {
        bucketId: req.params.bucketId,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to retrieve memory detail" });
    }
  }
);

router.patch(
  "/:bucketId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { bucketId } = req.params;

      if (!bucketId) {
        res.status(400).json({ error: "bucketId is required" });
        return;
      }

      const { bucketStore } = getDependencies();

      const existing = await bucketStore.getBucketById(bucketId, req.userId);

      if (!existing) {
        res.status(404).json({ error: "Memory not found" });
        return;
      }

      const updates: BucketUpdateParams = {};
      const body = req.body as Record<string, unknown>;

      if (body.canonical !== undefined) {
        if (typeof body.canonical !== "string" || !body.canonical.trim()) {
          res.status(400).json({ error: "canonical must be a non-empty string" });
          return;
        }

        updates.canonical = body.canonical.trim();
      }

      if (body.importance !== undefined) {
        const num = Number(body.importance);

        if (isNaN(num) || num < 1 || num > 10) {
          res.status(400).json({ error: "importance must be a number between 1 and 10" });
          return;
        }

        updates.importance = Math.round(num);
      }

      if (body.conceptType !== undefined) {
        if (typeof body.conceptType !== "string" || !isConceptType(body.conceptType)) {
          res.status(400).json({ error: "Invalid concept type" });
          return;
        }

        updates.conceptType = body.conceptType as ConceptType;
      }

      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "No valid fields to update" });
        return;
      }

      await bucketStore.updateBucket(bucketId, updates);

      res.status(200).json({
        message: "Memory updated",
        bucketId,
        updates,
      });
    } catch (error) {
      logger.error("PATCH /memories/:bucketId failed", {
        bucketId: req.params.bucketId,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to update memory" });
    }
  }
);

router.delete(
  "/:bucketId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { bucketId } = req.params;

      if (!bucketId) {
        res.status(400).json({ error: "bucketId is required" });
        return;
      }

      const { bucketStore, embeddingStore, relationshipStore } = getDependencies();

      const existing = await bucketStore.getBucketById(bucketId, req.userId);

      if (!existing) {
        res.status(404).json({ error: "Memory not found" });
        return;
      }

      await embeddingStore.deleteEmbedding(bucketId);
      await relationshipStore.deleteByBucket(bucketId);
      await bucketStore.deleteBucket(bucketId, req.userId);

      res.status(200).json({
        message: "Memory deleted",
        bucketId,
      });
    } catch (error) {
      logger.error("DELETE /memories/:bucketId failed", {
        bucketId: req.params.bucketId,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to delete memory" });
    }
  }
);

export default router;