import { query, queryOne, queryMany } from "../database";
import config from "../config";
import logger from "../utils/logger";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

function clampUnit(value: unknown): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));

  if (!Number.isFinite(num)) {
    return 0;
  }

  return Math.max(0, Math.min(1, num));
}

export interface SimilarityResult {
  bucketId: string;
  similarity: number;
}

export interface CorrelationSearchOptions {
  userId: string;
  excludeDocumentId?: string | null;
  excludeBucketIds?: string[];
  threshold?: number;
  limit?: number;
}

export class EmbeddingStore {
  private readonly dimension: number;

  constructor() {
    this.dimension = config.embedding.dimension;
  }

  private correlationMinSimilarity(): number {
    const value = Number((config as any).correlation?.minSimilarity ?? 0.7);
    return clampUnit(Number.isFinite(value) ? value : 0.7);
  }

  private serializeVector(vector: number[]): string {
    return `[${vector.join(",")}]`;
  }

  private deserializeVector(raw: string): number[] {
    const cleaned = raw.replace(/^\[|\]$/g, "");
    return cleaned.split(",").map((s) => parseFloat(s.trim()));
  }

  private validateVector(vector: number[]): void {
    if (!Array.isArray(vector)) {
      throw new Error("Embedding must be an array");
    }

    if (vector.length !== this.dimension) {
      throw new Error(
        `Embedding dimension mismatch: expected ${this.dimension}, got ${vector.length}`
      );
    }

    let hasNonFinite = false;
    let allZero = true;

    for (let i = 0; i < vector.length; i++) {
      if (!Number.isFinite(vector[i])) {
        hasNonFinite = true;
      }

      if (vector[i] !== 0) {
        allZero = false;
      }
    }

    if (hasNonFinite) {
      throw new Error("Embedding contains non-finite values");
    }

    if (allZero) {
      throw new Error("Embedding vector is all zeros");
    }
  }

  private buildSearchSql(
    serializedVector: string,
    userId: string | null,
    documentId: string | null,
    limit: number,
    threshold?: number
  ): { text: string; values: unknown[] } {
    const values: unknown[] = [serializedVector];
    let idx = 2;

    let join = "";
    const where: string[] = [];

    if (userId) {
      join = "JOIN buckets b ON b.bucket_id = e.bucket_id";
      where.push(`b.user_id = $${idx++}::uuid`);
      values.push(userId);
    }

    if (documentId) {
      if (!join) {
        join = "JOIN buckets b ON b.bucket_id = e.bucket_id";
      }

      where.push(`b.document_id = $${idx++}::uuid`);
      values.push(documentId);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

    if (threshold === undefined) {
      values.push(limit);

      return {
        text: `SELECT e.bucket_id,
                      1 - (e.vector <=> $1::vector) AS similarity
               FROM embeddings e
               ${join}
               ${whereClause}
               ORDER BY e.vector <=> $1::vector
               LIMIT $${idx}`,
        values,
      };
    }

    values.push(threshold);
    const thresholdParam = idx++;

    values.push(limit);
    const limitParam = idx;

    return {
      text: `SELECT bucket_id, similarity
             FROM (
               SELECT e.bucket_id,
                      1 - (e.vector <=> $1::vector) AS similarity
               FROM embeddings e
               ${join}
               ${whereClause}
             ) AS s
             WHERE s.similarity >= $${thresholdParam}
             ORDER BY s.similarity DESC
             LIMIT $${limitParam}`,
      values,
    };
  }

  private buildCorrelationSearchSql(
    serializedVector: string,
    options: CorrelationSearchOptions,
    safeBucketIds: string[],
    excludeDocumentId: string | null,
    limit: number,
    threshold: number
  ): { text: string; values: unknown[] } {
    const values: unknown[] = [serializedVector, options.userId];
    let idx = 3;

    const conditions: string[] = [`b.user_id = $2::uuid`];

    values.push(safeBucketIds);
    conditions.push(`b.bucket_id <> ALL($${idx++}::uuid[])`);

    if (excludeDocumentId) {
      values.push(excludeDocumentId);
      conditions.push(
        `(b.document_id IS NULL OR b.document_id <> $${idx++}::uuid)`
      );
    }

    values.push(limit);
    const limitParam = idx++;

    values.push(threshold);
    const thresholdParam = idx++;

    return {
      text: `SELECT bucket_id, similarity
             FROM (
               SELECT e.bucket_id,
                      1 - (e.vector <=> $1::vector) AS similarity
               FROM embeddings e
               JOIN buckets b ON b.bucket_id = e.bucket_id
               WHERE ${conditions.join(" AND ")}
               ORDER BY e.vector <=> $1::vector
               LIMIT $${limitParam}
             ) AS s
             WHERE s.similarity >= $${thresholdParam}
             ORDER BY s.similarity DESC`,
      values,
    };
  }

  async storeEmbedding(
    bucketId: string,
    vector: number[],
    documentId?: string | null
  ): Promise<void> {
    if (!isValidUuid(bucketId)) {
      throw new Error("Invalid bucketId for embedding storage");
    }

    this.validateVector(vector);

    try {
      await query(
        `INSERT INTO embeddings (bucket_id, vector)
         VALUES ($1::uuid, $2::vector)
         ON CONFLICT (bucket_id)
         DO UPDATE SET vector = EXCLUDED.vector, created_at = now()`,
        [bucketId, this.serializeVector(vector)]
      );
    } catch (error) {
      logger.error("storeEmbedding failed", {
        bucketId,
        documentId,
        vectorDimension: vector.length,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async searchSimilar(
    queryVector: number[],
    limit: number = 20,
    userId?: string | null,
    documentId?: string | null
  ): Promise<SimilarityResult[]> {
    this.validateVector(queryVector);

    if (userId && !isValidUuid(userId)) {
      return [];
    }

    if (documentId && !isValidUuid(documentId)) {
      return [];
    }

    const safeUserId = userId && isValidUuid(userId) ? userId : null;
    const safeDocumentId =
      documentId && isValidUuid(documentId) ? documentId : null;

    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 20)));

    try {
      const sql = this.buildSearchSql(
        this.serializeVector(queryVector),
        safeUserId,
        safeDocumentId,
        safeLimit
      );

      const rows = await queryMany<{ bucket_id: string; similarity: number }>(
        sql.text,
        sql.values
      );

      return rows
        .filter(
          (row) => typeof row.similarity === "number" && !isNaN(row.similarity)
        )
        .map((row) => ({
          bucketId: row.bucket_id,
          similarity: Number(row.similarity),
        }));
    } catch (error) {
      logger.error("searchSimilar failed", {
        queryDimension: queryVector.length,
        limit: safeLimit,
        userId: safeUserId,
        documentId: safeDocumentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async searchSimilarWithinDocument(
    queryVector: number[],
    documentId: string,
    limit: number = 20,
    userId?: string | null
  ): Promise<SimilarityResult[]> {
    if (!isValidUuid(documentId)) {
      return [];
    }

    return this.searchSimilar(queryVector, limit, userId, documentId);
  }

  async searchSimilarAboveThreshold(
    queryVector: number[],
    threshold: number,
    limit: number = 20,
    userId?: string | null,
    documentId?: string | null
  ): Promise<SimilarityResult[]> {
    this.validateVector(queryVector);

    if (userId && !isValidUuid(userId)) {
      return [];
    }

    if (documentId && !isValidUuid(documentId)) {
      return [];
    }

    const safeUserId = userId && isValidUuid(userId) ? userId : null;
    const safeDocumentId =
      documentId && isValidUuid(documentId) ? documentId : null;

    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit || 20)));
    const safeThreshold = clampUnit(threshold);

    try {
      const sql = this.buildSearchSql(
        this.serializeVector(queryVector),
        safeUserId,
        safeDocumentId,
        safeLimit,
        safeThreshold
      );

      const rows = await queryMany<{ bucket_id: string; similarity: number }>(
        sql.text,
        sql.values
      );

      return rows
        .filter(
          (row) => typeof row.similarity === "number" && !isNaN(row.similarity)
        )
        .map((row) => ({
          bucketId: row.bucket_id,
          similarity: Number(row.similarity),
        }));
    } catch (error) {
      logger.error("searchSimilarAboveThreshold failed", {
        queryDimension: queryVector.length,
        threshold: safeThreshold,
        limit: safeLimit,
        userId: safeUserId,
        documentId: safeDocumentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async searchSimilarForCorrelation(
    queryVector: number[],
    options: CorrelationSearchOptions
  ): Promise<SimilarityResult[]> {
    this.validateVector(queryVector);

    if (!options.userId || !isValidUuid(options.userId)) {
      return [];
    }

    const safeBucketIds = (options.excludeBucketIds ?? []).filter(isValidUuid);

    const excludeDocumentId =
      options.excludeDocumentId && isValidUuid(options.excludeDocumentId)
        ? options.excludeDocumentId
        : null;

    const safeLimit = Math.max(
      1,
      Math.min(100, Math.floor(options.limit ?? 20))
    );

    const threshold = clampUnit(
      options.threshold ?? this.correlationMinSimilarity()
    );

    try {
      const sql = this.buildCorrelationSearchSql(
        this.serializeVector(queryVector),
        options,
        safeBucketIds,
        excludeDocumentId,
        safeLimit,
        threshold
      );

      const rows = await queryMany<{ bucket_id: string; similarity: number }>(
        sql.text,
        sql.values
      );

      return rows
        .filter(
          (row) => typeof row.similarity === "number" && !isNaN(row.similarity)
        )
        .map((row) => ({
          bucketId: row.bucket_id,
          similarity: Number(row.similarity),
        }));
    } catch (error) {
      logger.error("searchSimilarForCorrelation failed", {
        userId: options.userId,
        excludeDocumentId: options.excludeDocumentId ?? null,
        excludeBucketCount: options.excludeBucketIds?.length ?? 0,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async deleteEmbedding(bucketId: string): Promise<void> {
    if (!isValidUuid(bucketId)) {
      return;
    }

    try {
      await query("DELETE FROM embeddings WHERE bucket_id = $1::uuid", [
        bucketId,
      ]);
    } catch (error) {
      logger.error("deleteEmbedding failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async deleteByBucket(bucketId: string): Promise<number> {
    if (!isValidUuid(bucketId)) {
      return 0;
    }

    try {
      const result = await query(
        "DELETE FROM embeddings WHERE bucket_id = $1::uuid",
        [bucketId]
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

  async getCount(): Promise<number> {
    try {
      const row = await queryOne<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM embeddings"
      );

      return row?.count ?? 0;
    } catch (error) {
      logger.error("getCount failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async hasEmbedding(bucketId: string): Promise<boolean> {
    if (!isValidUuid(bucketId)) {
      return false;
    }

    try {
      const row = await queryOne<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM embeddings WHERE bucket_id = $1::uuid) AS exists",
        [bucketId]
      );

      return row?.exists ?? false;
    } catch (error) {
      logger.error("hasEmbedding failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getEmbedding(bucketId: string): Promise<number[] | null> {
    if (!isValidUuid(bucketId)) {
      return null;
    }

    try {
      const row = await queryOne<{ vector: string }>(
        "SELECT vector::text AS vector FROM embeddings WHERE bucket_id = $1::uuid",
        [bucketId]
      );

      if (!row?.vector) {
        return null;
      }

      return this.deserializeVector(row.vector);
    } catch (error) {
      logger.error("getEmbedding failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async batchStoreEmbeddings(entries: Array<{ bucketId: string; vector: number[] }>): Promise<number> {
    if (entries.length === 0) return 0;

    const deduplicated = new Map<string, { bucketId: string; serialized: string }>();

    for (const e of entries) {
      if (!isValidUuid(e.bucketId)) continue;
      try {
        this.validateVector(e.vector);
        deduplicated.set(e.bucketId, {
          bucketId: e.bucketId,
          serialized: this.serializeVector(e.vector),
        });
      } catch { /* skip invalid */ }
    }

    if (deduplicated.size === 0) return 0;

    const valid = Array.from(deduplicated.values());

    try {
      const params: unknown[] = [];
      const clauses: string[] = [];
      let idx = 1;
      for (const e of valid) {
        clauses.push(`($${idx++}::uuid, $${idx++}::vector)`);
        params.push(e.bucketId, e.serialized);
      }
      await query(
        `INSERT INTO embeddings (bucket_id, vector) VALUES ${clauses.join(", ")}
ON CONFLICT (bucket_id) DO UPDATE SET vector = EXCLUDED.vector, created_at = now()`,
        params
      );
      return valid.length;
    } catch (error) {
      logger.error("batchStoreEmbeddings bulk failed", { error: (error as Error).message });
      for (const e of valid) {
        try {
          await this.storeEmbedding(e.bucketId, this.deserializeVector(e.serialized));
        } catch { /* skip individual failures */ }
      }
      return valid.length;
    }
  }

  async initializeVectorIndex(): Promise<void> {
    try {
      await query(
        "CREATE VECTOR INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings (vector)"
      );

      logger.info("Vector index created or already exists");
    } catch (error) {
      const msg = (error as Error).message;

      if (msg.includes("already exists")) {
        logger.debug("Vector index already exists");
        return;
      }

      logger.warn(
        "Vector index creation failed, falling back to brute-force search",
        {
          error: msg,
        }
      );
    }
  }

  async getOrphanedEmbeddings(): Promise<string[]> {
    try {
      const rows = await queryMany<{ bucket_id: string }>(
        `SELECT e.bucket_id
         FROM embeddings e
         LEFT JOIN buckets b ON e.bucket_id = b.bucket_id
         WHERE b.bucket_id IS NULL`
      );

      return rows.map((r) => r.bucket_id);
    } catch (error) {
      logger.error("getOrphanedEmbeddings failed", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  async getMissingEmbeddings(): Promise<string[]> {
    try {
      const rows = await queryMany<{ bucket_id: string }>(
        `SELECT b.bucket_id
         FROM buckets b
         LEFT JOIN embeddings e ON b.bucket_id = e.bucket_id
         WHERE e.embedding_id IS NULL`
      );

      return rows.map((r) => r.bucket_id);
    } catch (error) {
      logger.error("getMissingEmbeddings failed", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  async reconcileIndex(): Promise<{
    orphanedRemoved: number;
    missingFlagged: number;
  }> {
    let orphanedRemoved = 0;
    let missingFlagged = 0;

    try {
      const orphaned = await this.getOrphanedEmbeddings();

      for (const bucketId of orphaned) {
        await this.deleteEmbedding(bucketId);
        orphanedRemoved++;
      }

      const missing = await this.getMissingEmbeddings();

      missingFlagged = missing.length;

      if (orphanedRemoved > 0 || missingFlagged > 0) {
        logger.info("Embedding index reconciliation complete", {
          orphanedRemoved,
          missingFlagged,
        });
      }
    } catch (error) {
      logger.error("reconcileIndex failed", {
        error: (error as Error).message,
      });
    }

    return { orphanedRemoved, missingFlagged };
  }
}

let embeddingStoreInstance: EmbeddingStore | null = null;

export function getEmbeddingStore(): EmbeddingStore {
  if (!embeddingStoreInstance) {
    embeddingStoreInstance = new EmbeddingStore();
  }

  return embeddingStoreInstance;
}