import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../auth/middleware";
import { getDependencies } from "./dependencies";
import logger from "../utils/logger";

const router = Router();
router.get(
  "/memories",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { bucketStore, relationshipStore, embeddingStore, strengthTracker } =
        getDependencies();
      const [buckets, allRelationships, embeddingCount] = await Promise.all([
        bucketStore.getAllBuckets(undefined, userId),
        relationshipStore.getAll(),
        embeddingStore.getCount(),
      ]);
      const bucketIdSet = new Set(buckets.map((b) => b.bucketId));
      const canonicalSet = new Set(
        buckets.map((b) => String(b.canonical || "").toLowerCase())
      );
      const relationships = allRelationships.filter((rel: any) => {
        const sourceId = rel.sourceBucketId ?? rel.source_bucket_id ?? null;
        const targetId = rel.targetBucketId ?? rel.target_bucket_id ?? null;
        if (sourceId && targetId) {
          return bucketIdSet.has(sourceId) && bucketIdSet.has(targetId);
        }
        const sourceKey = String(rel.sourceBucket ?? rel.source_bucket ?? "").toLowerCase();
        const targetKey = String(rel.targetBucket ?? rel.target_bucket ?? "").toLowerCase();
        return canonicalSet.has(sourceKey) && canonicalSet.has(targetKey);
      });

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
          decayRate: bucket.decayRate,
          createdAt: bucket.createdAt.toISOString(),
        };
      });

      const exportData = {
        exportType: "memories",
        exportedAt: new Date().toISOString(),
        version: "1.0.0",
        counts: {
          buckets: buckets.length,
          relationships: relationships.length,
          embeddings: embeddingCount,
        },
        buckets: enriched,
        relationships: relationships.map((rel) => ({
          relationshipId: rel.relationshipId,
          sourceBucket: rel.sourceBucket,
          targetBucket: rel.targetBucket,
          relationType: rel.relationType,
          confidence: rel.confidence,
          createdAt: rel.createdAt.toISOString(),
        })),
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="contextos-memories-${Date.now()}.json"`
      );
      res.status(200).json(exportData);
    } catch (error) {
      logger.error("GET /export/memories failed", {
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to export memories" });
    }
  }
);

router.get(
  "/conversations",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const { sessionStore, rawStore } = getDependencies();

      const sessions = await sessionStore.getSessionsByUser(userId);

      const conversations: Array<{
        sessionId: string;
        title: string;
        createdAt: string;
        messageCount: number;
        messages: Array<{
          role: string;
          content: string;
          timestamp: string;
        }>;
      }> = [];

      for (const session of sessions) {
        try {
          const messages = await rawStore.getMessageHistory(session.sessionId);

          conversations.push({
            sessionId: session.sessionId,
            title: session.title,
            createdAt: session.createdAt.toISOString(),
            messageCount: messages.length,
            messages: messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
              timestamp: typeof msg.timestamp === "string" ? msg.timestamp : new Date(msg.timestamp).toISOString(),
            })),
          });
        } catch (msgError) {
          logger.debug("Failed to export conversation messages", {
            sessionId: session.sessionId,
            error: (msgError as Error).message,
          });
        }
      }

      const exportData = {
        exportType: "conversations",
        exportedAt: new Date().toISOString(),
        version: "1.0.0",
        userId,
        count: conversations.length,
        conversations,
      };

      res.setHeader("Content-Type", "application/json");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="contextos-conversations-${Date.now()}.json"`
      );
      res.status(200).json(exportData);
    } catch (error) {
      logger.error("GET /export/conversations failed", {
        userId: req.userId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to export conversations" });
    }
  }
);

router.post(
  "/backup",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const {
        bucketStore,
        relationshipStore,
        rawStore,
        sessionStore,
        embeddingStore,
        strengthTracker,
        s3Client,
      } = getDependencies();

      const [buckets, relationships, sessions, documents, embeddingCount] = await Promise.all([
        bucketStore.getAllBuckets(undefined, userId),
        relationshipStore.getAll(userId),
        sessionStore.getSessionsByUser(userId),
        rawStore.getAllDocuments(userId),
        embeddingStore.getCount(),
      ]);

      const conversations: Array<{
        sessionId: string;
        title: string;
        messages: Array<{ role: string; content: string; timestamp: string }>;
      }> = [];

      for (const session of sessions) {
        try {
          const messages = await rawStore.getMessageHistory(session.sessionId);
          conversations.push({
            sessionId: session.sessionId,
            title: session.title,
            messages: messages.map((msg) => ({
              role: msg.role,
              content: msg.content,
              timestamp: typeof msg.timestamp === "string" ? msg.timestamp : new Date(msg.timestamp).toISOString(),
            })),
          });
        } catch (convError) {
          logger.debug("Failed to backup conversation", {
            sessionId: session.sessionId,
            error: (convError as Error).message,
          });
        }
      }

      const backupData = {
        backupType: "full",
        createdAt: new Date().toISOString(),
        version: "1.0.0",
        userId,
        summary: {
          buckets: buckets.length,
          relationships: relationships.length,
          conversations: conversations.length,
          documents: documents.length,
          embeddings: embeddingCount,
        },
        buckets: buckets.map((b: any) => ({
          bucketId: b.bucketId,
          canonical: b.canonical,
          strength: b.strength,
          importance: b.importance,
          conceptType: b.conceptType,
          lastAccessed: b.lastAccessed.toISOString(),
          accessCount: b.accessCount,
          decayRate: b.decayRate,
          createdAt: b.createdAt.toISOString(),
        })),
        relationships: relationships.map((r: any) => ({
          relationshipId: r.relationshipId,
          sourceBucket: r.sourceBucket,
          targetBucket: r.targetBucket,
          relationType: r.relationType,
          confidence: r.confidence,
          createdAt: r.createdAt.toISOString(),
        })),
        conversations,
        documents: documents.map((d: any) => ({
          documentId: d.documentId,
          filename: d.filename,
          fileType: d.fileType,
          uploadedAt: d.uploadedAt.toISOString(),
        })),
      };

      const backupJson = JSON.stringify(backupData, null, 2);
      const backupKey = `backups/${userId}/backup-${Date.now()}.json`;

      let s3Url: string | null = null;
      try {
        await s3Client.upload(backupKey, backupJson, "application/json");
        s3Url = await s3Client.getPresignedUrl(backupKey, 86400);
      } catch (s3Error) {
        logger.warn("S3 backup upload failed", {
          userId,
          error: (s3Error as Error).message,
        });
      }

      res.status(200).json({
        message: "Backup created",
        backupKey,
        downloadUrl: s3Url,
        summary: backupData.summary,
        createdAt: backupData.createdAt,
      });
    } catch (error) {
      logger.error("POST /export/backup failed", {
        userId: req.userId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to create backup" });
    }
  }
);

router.get(
  "/stats",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const { bucketStore, relationshipStore, rawStore, sessionStore, embeddingStore, s3Client } =
        getDependencies();

      const [
        totalBuckets,
        totalRelationships,
        totalMessages,
        totalSessions,
        totalDocuments,
        embeddingCount,
      ] = await Promise.all([
        bucketStore.getTotalCount(userId),
        relationshipStore.getTotalCount(userId),
        rawStore.getTotalMessages(userId),
        sessionStore.getTotalCount(userId),
        rawStore.getTotalDocuments(userId),
        embeddingStore.getCount(),
      ]);

      let storageUsage = { totalSize: 0, objectCount: 0 };
      try {
        storageUsage = await s3Client.getStorageUsage();
      } catch (s3Error) {
        logger.debug("Failed to get storage usage for export stats", {
          error: (s3Error as Error).message,
        });
      }

      res.status(200).json({
        exportable: {
          buckets: totalBuckets,
          relationships: totalRelationships,
          messages: totalMessages,
          sessions: totalSessions,
          documents: totalDocuments,
          embeddings: embeddingCount,
        },
        storage: {
          totalSizeBytes: storageUsage.totalSize,
          totalSizeMB: Math.round((storageUsage.totalSize / (1024 * 1024)) * 100) / 100,
          objectCount: storageUsage.objectCount,
        },
      });
    } catch (error) {
      logger.error("GET /export/stats failed", {
        userId: req.userId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to retrieve export stats" });
    }
  }
);

export default router;