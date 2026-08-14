import { query, queryOne, queryMany, withTransaction } from "../database";
import type { ConceptType } from "../models/concept.model";
import {
  Bucket,
  BucketItem,
  BucketRow,
  BucketItemRow,
  BucketWithItems,
  BucketCreateParams,
  BucketUpdateParams,
  BucketFilters,
  mapRowToBucket,
  mapRowToBucketItem,
  mapRowToBucketWithItems,
} from "../models/bucket.model";
import config from "../config";
import logger from "../utils/logger";

const MODIFIER_SUFFIXES = [
  " system",
  " module",
  " approach",
  " method",
  " technique",
  " tool",
  " framework",
  " library",
  " platform",
  " service",
  " component",
  " feature",
];

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export function normalizeKey(label: string): string {
  let key = label.toLowerCase().trim();

  for (const suffix of MODIFIER_SUFFIXES) {
    if (key.endsWith(suffix)) {
      key = key.slice(0, -suffix.length);
    }
  }

  key = key.replace(/[^a-z0-9\s]/g, "");

  const words = key.split(/\s+/).filter((w) => w.length > 0).sort();

  return words.join("_");
}

export interface DocumentMemoryRef {
  bucketId: string;
  canonical: string;
  conceptType: string;
  importance: number;
  strength: number;
}

export interface ExistingMemoryContextRow {
  bucketId: string;
  label: string;
  definition: string | null;
  conceptType: string;
  importance: number;
  strength: number;
  documentId: string | null;
}

export interface BucketLabelRow {
  bucketId: string;
  label: string;
  normalized: string;
}

export interface TopUserMemoryOptions {
  limit?: number;
  excludeDocumentId?: string | null;
  minStrength?: number;
}

interface ExistingMemorySqlRow {
  bucket_id: string;
  canonical: string;
  definition: string | null;
  concept_type: string;
  importance: number;
  strength: number;
  document_id: string | null;
}

function mapExistingMemorySqlRow(
  row: ExistingMemorySqlRow
): ExistingMemoryContextRow {
  return {
    bucketId: row.bucket_id,
    label: row.canonical,
    definition: row.definition,
    conceptType: row.concept_type,
    importance: Number(row.importance),
    strength: Number(row.strength),
    documentId: row.document_id,
  };
}

export class BucketStore {
  private readonly userIdCache = new Map<string, string | null>();

  private setUserIdCache(documentId: string, userId: string | null): void {
    if (this.userIdCache.size >= 10000) {
      this.userIdCache.clear();
    }

    this.userIdCache.set(documentId, userId);
  }

  private safeUserId(userId?: string | null): string | null {
    return userId && isValidUuid(userId) ? userId : null;
  }

  private safeDocumentId(documentId?: string | null): string | null {
    return documentId && isValidUuid(documentId) ? documentId : null;
  }

  private async resolveUserId(
    documentId?: string | null
  ): Promise<string | null> {
    if (!documentId || !isValidUuid(documentId)) {
      return null;
    }

    const cached = this.userIdCache.get(documentId);

    if (cached !== undefined) {
      return cached;
    }

    try {
      const row = await queryOne<{ user_id: string | null }>(
        "SELECT user_id FROM documents WHERE document_id = $1::uuid",
        [documentId]
      );

      const userId = row?.user_id ?? null;

      this.setUserIdCache(documentId, userId);

      return userId;
    } catch (error) {
      logger.error("resolveUserId failed", {
        documentId,
        error: (error as Error).message,
      });

      return null;
    }
  }

  private async resolveUserIdsForEntries(
    entries: Array<{ documentId?: string | null; userId?: string | null }>
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    const needed = new Set<string>();

    for (const entry of entries) {
      if (entry.userId && isValidUuid(entry.userId)) {
        continue;
      }

      if (entry.documentId && isValidUuid(entry.documentId)) {
        const cached = this.userIdCache.get(entry.documentId);

        if (cached !== undefined) {
          result.set(entry.documentId, cached);
        } else {
          needed.add(entry.documentId);
        }
      }
    }

    if (needed.size > 0) {
      try {
        const rows = await queryMany<{
          document_id: string;
          user_id: string | null;
        }>(
          "SELECT document_id, user_id FROM documents WHERE document_id = ANY($1::uuid[])",
          [Array.from(needed)]
        );

        const found = new Set<string>();

        for (const row of rows) {
          found.add(row.document_id);
          this.setUserIdCache(row.document_id, row.user_id);
          result.set(row.document_id, row.user_id);
        }

        for (const documentId of needed) {
          if (!found.has(documentId)) {
            this.setUserIdCache(documentId, null);
            result.set(documentId, null);
          }
        }
      } catch (error) {
        logger.error("resolveUserIdsForEntries failed", {
          count: needed.size,
          error: (error as Error).message,
        });
      }
    }

    return result;
  }

  private buildUpdateSet(params: BucketUpdateParams): {
    clauses: string;
    values: unknown[];
  } {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.canonical !== undefined) {
      fields.push(`canonical = $${idx++}`);
      values.push(params.canonical);
    }

    if (params.importance !== undefined) {
      fields.push(`importance = $${idx++}`);
      values.push(params.importance);
    }

    if (params.conceptType !== undefined) {
      fields.push(`concept_type = $${idx++}`);
      values.push(params.conceptType);
    }

    if (params.strength !== undefined) {
      fields.push(`strength = $${idx++}`);
      values.push(params.strength);
    }

    if (params.decayRate !== undefined) {
      fields.push(`decay_rate = $${idx++}`);
      values.push(params.decayRate);
    }

    return {
      clauses: fields.join(", "),
      values,
    };
  }

  private buildFilterWhere(
    filters?: BucketFilters,
    userId?: string | null
  ): {
    clauses: string;
    values: unknown[];
  } {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters?.conceptType) {
      conditions.push(`concept_type = $${idx++}`);
      values.push(filters.conceptType);
    }

    if (filters?.minStrength !== undefined) {
      conditions.push(`strength >= $${idx++}`);
      values.push(filters.minStrength);
    }

    if (filters?.maxStrength !== undefined) {
      conditions.push(`strength <= $${idx++}`);
      values.push(filters.maxStrength);
    }

    if (filters?.documentId && isValidUuid(filters.documentId)) {
      conditions.push(`document_id = $${idx++}::uuid`);
      values.push(filters.documentId);
    }

    if (filters?.search) {
      conditions.push(
        `(canonical ILIKE $${idx} OR bucket_id IN (SELECT bucket_id FROM bucket_items WHERE label ILIKE $${idx} OR definition ILIKE $${idx}))`
      );
      values.push(`%${filters.search}%`);
      idx++;
    }

    const safeUserId = this.safeUserId(userId);

    if (safeUserId) {
      conditions.push(`user_id = $${idx++}::uuid`);
      values.push(safeUserId);
    }

    return {
      clauses: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
      values,
    };
  }

  async findByNormalized(
    normalized: string,
    userId?: string | null
  ): Promise<string | null> {
    if (!normalized) {
      return null;
    }

    if (userId && !isValidUuid(userId)) {
      return null;
    }

    try {
      const row = userId
        ? await queryOne<{ bucket_id: string }>(
          "SELECT bucket_id FROM buckets WHERE normalized = $1 AND user_id = $2::uuid LIMIT 1",
          [normalized, userId]
        )
        : await queryOne<{ bucket_id: string }>(
          "SELECT bucket_id FROM buckets WHERE normalized = $1 AND user_id IS NULL LIMIT 1",
          [normalized]
        );

      return row?.bucket_id ?? null;
    } catch (error) {
      logger.error("findByNormalized failed", {
        normalized,
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async findByCanonicalAndDocument(
    canonical: string,
    documentId?: string,
    userId?: string | null
  ): Promise<string | null> {
    const normalized = normalizeKey(canonical);
    const safeUserId =
      this.safeUserId(userId) ?? (await this.resolveUserId(documentId));

    return this.findByNormalized(normalized, safeUserId);
  }

  async createBucket(
    params: BucketCreateParams & { userId?: string | null }
  ): Promise<string> {
    const userId = this.safeUserId(params.userId);
    const documentId = this.safeDocumentId(params.documentId);

    try {
      const result = await withTransaction(async (client) => {
        const bucketResult = await client.query(
          `INSERT INTO buckets (canonical, normalized, strength, importance, concept_type, decay_rate, document_id, user_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8::uuid)
           RETURNING bucket_id`,
          [
            params.canonical,
            params.normalized,
            params.strength ?? 0.5,
            params.importance,
            params.conceptType,
            params.decayRate,
            documentId,
            userId,
          ]
        );

        const bucketId = bucketResult.rows[0]?.bucket_id as string;

        await client.query(
          `INSERT INTO bucket_items (bucket_id, label, definition, source)
           VALUES ($1, $2, $3, $4)`,
          [
            bucketId,
            params.itemLabel,
            params.itemDefinition ?? null,
            params.itemSource ?? null,
          ]
        );

        return bucketId;
      });

      return result;
    } catch (error) {
      const msg = (error as Error).message || "";

      if (
        /duplicate|unique|idx_buckets_user_normalized|idx_buckets_null_normalized/i.test(
          msg
        )
      ) {
        logger.debug("createBucket race on normalized key; caller will merge", {
          canonical: params.canonical,
        });
      } else {
        logger.error("createBucket failed", {
          canonical: params.canonical,
          error: msg,
        });
      }

      throw error;
    }
  }

  async mergeIntoBucket(
    bucketId: string,
    label: string,
    definition?: string,
    source?: string,
    importance?: number,
    userId?: string | null
  ): Promise<void> {
    if (!isValidUuid(bucketId)) {
      return;
    }

    const safeUserId = this.safeUserId(userId);

    try {
      const retainWeight = Number(config.decay.retainWeight ?? 0.7);
      const accessBoostWeight = Number(config.decay.accessBoostWeight ?? 0.3);

      await withTransaction(async (client) => {
        await client.query(
          `INSERT INTO bucket_items (bucket_id, label, definition, source)
           VALUES ($1, $2, $3, $4)`,
          [bucketId, label, definition ?? null, source ?? null]
        );

        if (importance !== undefined) {
          if (safeUserId) {
            await client.query(
              `UPDATE buckets
               SET importance = GREATEST(importance, $1),
                   strength = LEAST(1.0, strength * $2 + 1.0 * $3),
                   last_accessed = now(),
                   access_count = access_count + 1
               WHERE bucket_id = $4::uuid AND user_id = $5::uuid`,
              [importance, retainWeight, accessBoostWeight, bucketId, safeUserId]
            );
          } else {
            await client.query(
              `UPDATE buckets
               SET importance = GREATEST(importance, $1),
                   strength = LEAST(1.0, strength * $2 + 1.0 * $3),
                   last_accessed = now(),
                   access_count = access_count + 1
               WHERE bucket_id = $4::uuid AND user_id IS NULL`,
              [importance, retainWeight, accessBoostWeight, bucketId]
            );
          }
        } else {
          if (safeUserId) {
            await client.query(
              `UPDATE buckets
               SET strength = LEAST(1.0, strength * $1 + 1.0 * $2),
                   last_accessed = now(),
                   access_count = access_count + 1
               WHERE bucket_id = $3::uuid AND user_id = $4::uuid`,
              [retainWeight, accessBoostWeight, bucketId, safeUserId]
            );
          } else {
            await client.query(
              `UPDATE buckets
               SET strength = LEAST(1.0, strength * $1 + 1.0 * $2),
                   last_accessed = now(),
                   access_count = access_count + 1
               WHERE bucket_id = $3::uuid AND user_id IS NULL`,
              [retainWeight, accessBoostWeight, bucketId]
            );
          }
        }
      });
    } catch (error) {
      logger.error("mergeIntoBucket failed", {
        bucketId,
        label,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getOrCreateBucket(
    label: string,
    definition: string,
    conceptType: string,
    importance: number,
    source: string,
    documentId?: string | null,
    userId?: string | null
  ): Promise<{ bucketId: string; isNew: boolean; exactMerge: boolean }> {
    const normalized = normalizeKey(label);

    const safeUserId =
      this.safeUserId(userId) ?? (await this.resolveUserId(documentId));
    const safeDocumentId = this.safeDocumentId(documentId);

    try {
      const existing = await this.findByNormalized(normalized, safeUserId);

      if (existing) {
        await this.mergeIntoBucket(
          existing,
          label,
          definition,
          source,
          importance,
          safeUserId
        );

        return { bucketId: existing, isNew: false, exactMerge: true };
      }

      const { getDecayRate } = await import("../memory/decay");
      const decayRate = getDecayRate(importance);

      try {
        const bucketId = await this.createBucket({
          canonical: label,
          normalized,
          importance,
          conceptType: conceptType as ConceptType,
          decayRate,
          itemLabel: label,
          itemDefinition: definition,
          itemSource: source,
          documentId: safeDocumentId,
          userId: safeUserId,
        });

        return { bucketId, isNew: true, exactMerge: false };
      } catch (createError) {
        const msg = (createError as Error).message.toLowerCase();

        if (msg.includes("duplicate") || msg.includes("unique")) {
          const retry = await this.findByNormalized(normalized, safeUserId);

          if (retry) {
            await this.mergeIntoBucket(
              retry,
              label,
              definition,
              source,
              importance,
              safeUserId
            );

            return { bucketId: retry, isNew: false, exactMerge: true };
          }
        }

        throw createError;
      }
    } catch (error) {
      logger.error("getOrCreateBucket failed", {
        label,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private async bulkUpsertFallback(
    entries: Array<{
      label: string;
      definition: string;
      conceptType: string;
      importance: number;
      source: string;
      documentId?: string | null;
      userId?: string | null;
    }>,
    resolvedUserIds: Map<string, string | null>
  ): Promise<{ newBuckets: number; mergedBuckets: number; bucketIds: string[] }> {
    let newBuckets = 0;
    let mergedBuckets = 0;
    const bucketIds: string[] = [];

    for (const entry of entries) {
      const userId =
        this.safeUserId(entry.userId) ??
        (entry.documentId ? resolvedUserIds.get(entry.documentId) ?? null : null);

      const result = await this.getOrCreateBucket(
        entry.label,
        entry.definition,
        entry.conceptType,
        entry.importance,
        entry.source,
        entry.documentId,
        userId
      );

      if (result.isNew) {
        newBuckets++;
      } else {
        mergedBuckets++;
      }

      bucketIds.push(result.bucketId);
    }

    return { newBuckets, mergedBuckets, bucketIds };
  }

  async bulkUpsertBuckets(
    entries: Array<{
      label: string;
      definition: string;
      conceptType: string;
      importance: number;
      source: string;
      documentId?: string | null;
      userId?: string | null;
    }>
  ): Promise<{ newBuckets: number; mergedBuckets: number; bucketIds: string[] }> {
    if (entries.length === 0) return { newBuckets: 0, mergedBuckets: 0, bucketIds: [] };

    const normalizedEntries = entries.map((e) => ({
      ...e,
      normalized: normalizeKey(e.label),
      userId: this.safeUserId(e.userId),
      documentId: this.safeDocumentId(e.documentId),
    }));

    const resolvedUserIds = await this.resolveUserIdsForEntries(entries);
    for (const e of normalizedEntries) {
      if (!e.userId && e.documentId) {
        e.userId = resolvedUserIds.get(e.documentId) ?? null;
      }
    }

    const { getDecayRate } = await import("../memory/decay");
    const retainWeight = Number(config.decay.retainWeight ?? 0.7);
    const accessBoostWeight = Number(config.decay.accessBoostWeight ?? 0.3);

    let newBuckets = 0;
    let mergedBuckets = 0;
    const bucketIds: string[] = [];

    try {
      await withTransaction(async (client) => {
        const normalizedKeys = Array.from(new Set(normalizedEntries.map((e) => e.normalized)));
        const userIds = Array.from(new Set(normalizedEntries.map((e) => e.userId).filter((u): u is string => !!u)));

        const existingRows = userIds.length > 0
          ? await client.query<{ bucket_id: string; normalized: string; user_id: string | null }>(
            `SELECT bucket_id, normalized, user_id FROM buckets WHERE normalized = ANY($1::text[]) AND (user_id = ANY($2::uuid[]) OR user_id IS NULL)`,
            [normalizedKeys, userIds]
          )
          : await client.query<{ bucket_id: string; normalized: string; user_id: string | null }>(
            `SELECT bucket_id, normalized, user_id FROM buckets WHERE normalized = ANY($1::text[])`,
            [normalizedKeys]
          );

        const existingMap = new Map<string, string>();
        for (const row of existingRows.rows) {
          existingMap.set(`${row.user_id ?? "null"}|${row.normalized}`, row.bucket_id);
        }

        const toCreate: typeof normalizedEntries = [];
        const toMerge: Array<typeof normalizedEntries[0] & { bucketId: string }> = [];

        for (const e of normalizedEntries) {
          const k = `${e.userId ?? "null"}|${e.normalized}`;
          const existingId = existingMap.get(k);
          if (existingId) {
            toMerge.push({ ...e, bucketId: existingId });
          } else {
            toCreate.push(e);
          }
        }

        const createdIds = new Map<string, string>();
        if (toCreate.length > 0) {
          const params: unknown[] = [];
          const clauses: string[] = [];
          let idx = 1;
          for (const e of toCreate) {
            clauses.push(`($${idx++}, $${idx++}, 0.5, $${idx++}, $${idx++}, $${idx++}, $${idx++}::uuid, $${idx++}::uuid)`);
            params.push(e.label, e.normalized, e.importance, e.conceptType, getDecayRate(e.importance), e.documentId, e.userId);
          }
          const insertRes = await client.query<{ bucket_id: string; normalized: string; user_id: string | null }>(
            `INSERT INTO buckets (canonical, normalized, strength, importance, concept_type, decay_rate, document_id, user_id)
           VALUES ${clauses.join(", ")}
           RETURNING bucket_id, normalized, user_id`,
            params
          );
          for (const row of insertRes.rows) {
            createdIds.set(`${row.user_id ?? "null"}|${row.normalized}`, row.bucket_id);
          }
        }

        for (const e of normalizedEntries) {
          const k = `${e.userId ?? "null"}|${e.normalized}`;
          const id = createdIds.get(k) ?? existingMap.get(k);
          if (id) {
            bucketIds.push(id);
            if (createdIds.has(k)) newBuckets++;
            else mergedBuckets++;
          }
        }

        if (bucketIds.length > 0) {
          const itemParams: unknown[] = [];
          const itemClauses: string[] = [];
          let idx = 1;
          for (let i = 0; i < normalizedEntries.length; i++) {
            const id = bucketIds[i];
            if (!id) continue;
            const e = normalizedEntries[i];
            itemClauses.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
            itemParams.push(id, e.label, e.definition ?? null, e.source ?? null);
          }
          if (itemClauses.length > 0) {
            await client.query(
              `INSERT INTO bucket_items (bucket_id, label, definition, source) VALUES ${itemClauses.join(", ")}`,
              itemParams
            );
          }
        }

        if (toMerge.length > 0) {
          const updateParams: unknown[] = [retainWeight, accessBoostWeight];
          const valueClauses: string[] = [];
          let idx = 3;
          for (const e of toMerge) {
            valueClauses.push(`($${idx++}::uuid, $${idx++}::float8)`);
            updateParams.push(e.bucketId, e.importance);
          }
          await client.query(
            `UPDATE buckets AS b SET
             importance = GREATEST(b.importance, v.imp),
             strength = LEAST(1.0, b.strength * $1 + 1.0 * $2),
             last_accessed = now(),
             access_count = b.access_count + 1
           FROM (VALUES ${valueClauses.join(", ")}) AS v(id, imp)
           WHERE b.bucket_id = v.id`,
            updateParams
          );
        }
      });
    } catch (error) {
      const msg = (error as Error).message || "";
      if (/duplicate|unique/i.test(msg)) {
        return this.bulkUpsertFallback(entries, resolvedUserIds);
      }
      logger.error("bulkUpsertBuckets failed", { error: msg });
      throw error;
    }

    return { newBuckets, mergedBuckets, bucketIds };
  }

  async getAllBuckets(
    filters?: BucketFilters,
    userId?: string | null
  ): Promise<Bucket[]> {
    if (userId && !isValidUuid(userId)) {
      return [];
    }

    try {
      const { clauses, values } = this.buildFilterWhere(filters, userId);

      let sql = `SELECT * FROM buckets ${clauses} ORDER BY last_accessed DESC`;

      if (filters?.limit) {
        sql += ` LIMIT $${values.length + 1}`;
        values.push(filters.limit);
      }

      if (filters?.offset) {
        sql += ` OFFSET $${values.length + 1}`;
        values.push(filters.offset);
      }

      const rows = await queryMany<BucketRow>(sql, values);

      return rows.map(mapRowToBucket);
    } catch (error) {
      logger.error("getAllBuckets failed", {
        filters,
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getBucketById(
    bucketId: string,
    userId?: string | null
  ): Promise<BucketWithItems | null> {
    if (!isValidUuid(bucketId)) {
      return null;
    }

    if (userId && !isValidUuid(userId)) {
      return null;
    }

    try {
      const bucketRow = userId
        ? await queryOne<BucketRow>(
          "SELECT * FROM buckets WHERE bucket_id = $1::uuid AND user_id = $2::uuid",
          [bucketId, userId]
        )
        : await queryOne<BucketRow>(
          "SELECT * FROM buckets WHERE bucket_id = $1::uuid",
          [bucketId]
        );

      if (!bucketRow) {
        return null;
      }

      const itemRows = await queryMany<BucketItemRow>(
        "SELECT * FROM bucket_items WHERE bucket_id = $1::uuid ORDER BY timestamp ASC",
        [bucketId]
      );

      return mapRowToBucketWithItems(bucketRow, itemRows);
    } catch (error) {
      logger.error("getBucketById failed", {
        bucketId,
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getCanonical(bucketId: string): Promise<string | null> {
    if (!isValidUuid(bucketId)) {
      return null;
    }

    try {
      const row = await queryOne<{ canonical: string }>(
        "SELECT canonical FROM buckets WHERE bucket_id = $1::uuid",
        [bucketId]
      );

      return row?.canonical ?? null;
    } catch (error) {
      logger.error("getCanonical failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getDefinition(bucketId: string): Promise<string | null> {
    if (!isValidUuid(bucketId)) {
      return null;
    }

    try {
      const row = await queryOne<{ definition: string }>(
        `SELECT definition
         FROM bucket_items
         WHERE bucket_id = $1::uuid AND definition IS NOT NULL
         ORDER BY timestamp DESC
         LIMIT 1`,
        [bucketId]
      );

      return row?.definition ?? null;
    } catch (error) {
      logger.error("getDefinition failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updateAccess(bucketId: string, newStrength: number): Promise<void> {
    if (!isValidUuid(bucketId)) {
      return;
    }

    try {
      await query(
        `UPDATE buckets
         SET strength = $1,
             last_accessed = now(),
             access_count = access_count + 1
         WHERE bucket_id = $2::uuid`,
        [newStrength, bucketId]
      );
    } catch (error) {
      logger.error("updateAccess failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updateStrength(bucketId: string, newStrength: number): Promise<void> {
    if (!isValidUuid(bucketId)) {
      return;
    }

    try {
      await query(
        "UPDATE buckets SET strength = $1 WHERE bucket_id = $2::uuid",
        [newStrength, bucketId]
      );
    } catch (error) {
      logger.error("updateStrength failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updateBucket(
    bucketId: string,
    updates: BucketUpdateParams
  ): Promise<void> {
    if (!isValidUuid(bucketId)) {
      return;
    }

    const { clauses, values } = this.buildUpdateSet(updates);

    if (!clauses) {
      return;
    }

    try {
      await query(
        `UPDATE buckets SET ${clauses} WHERE bucket_id = $${values.length + 1
        }::uuid`,
        [...values, bucketId]
      );
    } catch (error) {
      logger.error("updateBucket failed", {
        bucketId,
        updates,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async deleteBucket(bucketId: string, userId?: string | null): Promise<void> {
    if (!isValidUuid(bucketId)) {
      return;
    }

    if (userId && !isValidUuid(userId)) {
      return;
    }

    try {
      if (userId) {
        await query(
          "DELETE FROM buckets WHERE bucket_id = $1::uuid AND user_id = $2::uuid",
          [bucketId, userId]
        );
      } else {
        await query(
          "DELETE FROM buckets WHERE bucket_id = $1::uuid AND user_id IS NULL",
          [bucketId]
        );
      }
    } catch (error) {
      logger.error("deleteBucket failed", {
        bucketId,
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private async countBuckets(where: string, params: unknown[]): Promise<number> {
    const row = await queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM buckets ${where}`,
      params
    );

    return row?.count ?? 0;
  }

  async countByCategory(userId?: string | null): Promise<{
    strong: number;
    fading: number;
    critical: number;
    forgotten: number;
  }> {
    if (userId && !isValidUuid(userId)) {
      return { strong: 0, fading: 0, critical: 0, forgotten: 0 };
    }

    try {
      const strongWhere = userId
        ? "WHERE strength >= 0.7 AND user_id = $1::uuid"
        : "WHERE strength >= 0.7";

      const fadingWhere = userId
        ? "WHERE strength >= 0.1 AND strength < 0.7 AND user_id = $1::uuid"
        : "WHERE strength >= 0.1 AND strength < 0.7";

      const criticalWhere = userId
        ? "WHERE strength >= 0.01 AND strength < 0.4 AND user_id = $1::uuid"
        : "WHERE strength >= 0.01 AND strength < 0.4";

      const forgottenWhere = userId
        ? "WHERE strength < 0.1 AND user_id = $1::uuid"
        : "WHERE strength < 0.1";

      const params = userId ? [userId] : [];

      const [strong, fading, critical, forgotten] = await Promise.all([
        this.countBuckets(strongWhere, params),
        this.countBuckets(fadingWhere, params),
        this.countBuckets(criticalWhere, params),
        this.countBuckets(forgottenWhere, params),
      ]);

      return { strong, fading, critical, forgotten };
    } catch (error) {
      logger.error("countByCategory failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async countByType(userId?: string | null): Promise<Record<string, number>> {
    if (userId && !isValidUuid(userId)) {
      return {};
    }

    try {
      let where = "";
      const values: unknown[] = [];

      if (userId) {
        where = "WHERE user_id = $1::uuid";
        values.push(userId);
      }

      const rows = await queryMany<{ concept_type: string; count: number }>(
        `SELECT concept_type, COUNT(*)::int AS count
         FROM buckets ${where}
         GROUP BY concept_type`,
        values
      );

      const result: Record<string, number> = {};

      for (const row of rows) {
        result[row.concept_type] = row.count;
      }

      return result;
    } catch (error) {
      logger.error("countByType failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getTotalCount(userId?: string | null): Promise<number> {
    if (userId && !isValidUuid(userId)) {
      return 0;
    }

    try {
      const where = userId ? "WHERE user_id = $1::uuid" : "";
      const params = userId ? [userId] : [];

      const row = await queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM buckets ${where}`,
        params
      );

      return row?.count ?? 0;
    } catch (error) {
      logger.error("getTotalCount failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getRecentActivity(
    limit: number = 10,
    userId?: string | null
  ): Promise<Bucket[]> {
    if (userId && !isValidUuid(userId)) {
      return [];
    }

    try {
      const rows = userId
        ? await queryMany<BucketRow>(
          "SELECT * FROM buckets WHERE user_id = $1::uuid ORDER BY last_accessed DESC LIMIT $2",
          [userId, limit]
        )
        : await queryMany<BucketRow>(
          "SELECT * FROM buckets ORDER BY last_accessed DESC LIMIT $1",
          [limit]
        );

      return rows.map(mapRowToBucket);
    } catch (error) {
      logger.error("getRecentActivity failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async searchBuckets(
    searchTerm: string,
    limit: number = 20,
    userId?: string | null
  ): Promise<Bucket[]> {
    if (userId && !isValidUuid(userId)) {
      return [];
    }

    try {
      const term = `%${searchTerm}%`;

      const rows = userId
        ? await queryMany<BucketRow>(
          `SELECT b.*
             FROM buckets b
             WHERE (
               b.canonical ILIKE $1
               OR b.bucket_id IN (
                 SELECT bucket_id
                 FROM bucket_items
                 WHERE label ILIKE $1 OR definition ILIKE $1
               )
             ) AND b.user_id = $2::uuid
             ORDER BY b.strength DESC
             LIMIT $3`,
          [term, userId, limit]
        )
        : await queryMany<BucketRow>(
          `SELECT b.*
             FROM buckets b
             WHERE (
               b.canonical ILIKE $1
               OR b.bucket_id IN (
                 SELECT bucket_id
                 FROM bucket_items
                 WHERE label ILIKE $1 OR definition ILIKE $1
               )
             )
             ORDER BY b.strength DESC
             LIMIT $2`,
          [term, limit]
        );

      return rows.map(mapRowToBucket);
    } catch (error) {
      logger.error("searchBuckets failed", {
        searchTerm,
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getMemoriesByDocumentId(
    documentId: string,
    userId?: string | null
  ): Promise<
    Array<{
      bucketId: string;
      canonical: string;
      conceptType: string;
      importance: number;
      strength: number;
    }>
  > {
    if (!isValidUuid(documentId)) {
      return [];
    }

    if (userId && !isValidUuid(userId)) {
      return [];
    }

    try {
      const rows = userId
        ? await queryMany<{
          bucket_id: string;
          canonical: string;
          concept_type: string;
          importance: number;
          strength: number;
        }>(
          `SELECT bucket_id, canonical, concept_type, importance, strength
             FROM buckets
             WHERE document_id = $1::uuid AND user_id = $2::uuid
             ORDER BY importance DESC, strength DESC, canonical ASC`,
          [documentId, userId]
        )
        : await queryMany<{
          bucket_id: string;
          canonical: string;
          concept_type: string;
          importance: number;
          strength: number;
        }>(
          `SELECT bucket_id, canonical, concept_type, importance, strength
             FROM buckets
             WHERE document_id = $1::uuid
             ORDER BY importance DESC, strength DESC, canonical ASC`,
          [documentId]
        );

      return rows.map((r) => ({
        bucketId: r.bucket_id,
        canonical: r.canonical,
        conceptType: r.concept_type,
        importance: Number(r.importance),
        strength: Number(r.strength),
      }));
    } catch (error) {
      logger.error("getMemoriesByDocumentId failed", {
        documentId,
        userId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async getItemsByBucketId(bucketId: string): Promise<BucketItem[]> {
    if (!isValidUuid(bucketId)) {
      return [];
    }

    try {
      const rows = await queryMany<BucketItemRow>(
        "SELECT * FROM bucket_items WHERE bucket_id = $1::uuid ORDER BY timestamp ASC",
        [bucketId]
      );

      return rows.map(mapRowToBucketItem);
    } catch (error) {
      logger.error("getItemsByBucketId failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getExistingMemoryContext(
    userId: string,
    limit: number = 40
  ): Promise<ExistingMemoryContextRow[]> {
    return this.getTopUserMemories(userId, { limit });
  }

  async getTopUserMemories(
    userId: string,
    options?: TopUserMemoryOptions
  ): Promise<ExistingMemoryContextRow[]> {
    if (!isValidUuid(userId)) {
      return [];
    }

    try {
      const limit = Math.max(1, Math.min(200, Math.floor(options?.limit ?? 40)));
      const values: unknown[] = [userId];
      let idx = 2;

      const where: string[] = ["b.user_id = $1::uuid"];

      if (options?.excludeDocumentId && isValidUuid(options.excludeDocumentId)) {
        where.push(`(b.document_id IS NULL OR b.document_id <> $${idx++}::uuid)`);
        values.push(options.excludeDocumentId);
      }

      const minStrength =
        options?.minStrength ??
        Math.max(0, Number(config.memory.forgottenThreshold ?? 0.1));

      where.push(`b.strength >= $${idx++}`);
      values.push(minStrength);

      values.push(limit);

      const limitParam = idx;

      const rows = await queryMany<ExistingMemorySqlRow>(
        `SELECT b.bucket_id,
                b.canonical,
                b.concept_type,
                b.importance,
                b.strength,
                b.document_id,
                (
                  SELECT bi.definition
                  FROM bucket_items bi
                  WHERE bi.bucket_id = b.bucket_id
                    AND bi.definition IS NOT NULL
                  ORDER BY bi.timestamp DESC
                  LIMIT 1
                ) AS definition
         FROM buckets b
         WHERE ${where.join(" AND ")}
         ORDER BY b.strength DESC, b.importance DESC, b.last_accessed DESC
         LIMIT $${limitParam}`,
        values
      );

      return rows.map(mapExistingMemorySqlRow);
    } catch (error) {
      logger.error("getTopUserMemories failed", {
        userId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async getDocumentBucketIds(
    documentId: string,
    userId?: string | null
  ): Promise<string[]> {
    if (!isValidUuid(documentId)) {
      return [];
    }

    if (userId && !isValidUuid(userId)) {
      return [];
    }

    try {
      const values: unknown[] = [documentId];

      let where = "document_id = $1::uuid";

      if (userId) {
        where += " AND user_id = $2::uuid";
        values.push(userId);
      }

      const rows = await queryMany<{ bucket_id: string }>(
        `SELECT bucket_id FROM buckets WHERE ${where}`,
        values
      );

      return rows.map((row) => row.bucket_id);
    } catch (error) {
      logger.error("getDocumentBucketIds failed", {
        documentId,
        userId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async getBucketLabelsByIds(bucketIds: string[]): Promise<BucketLabelRow[]> {
    const safeBucketIds = (bucketIds || []).filter(isValidUuid);

    if (safeBucketIds.length === 0) {
      return [];
    }

    try {
      const rows = await queryMany<{
        bucket_id: string;
        canonical: string;
        normalized: string;
      }>(
        `SELECT bucket_id, canonical, normalized
         FROM buckets
         WHERE bucket_id = ANY($1::uuid[])`,
        [safeBucketIds]
      );

      return rows.map((row) => ({
        bucketId: row.bucket_id,
        label: row.canonical,
        normalized: row.normalized,
      }));
    } catch (error) {
      logger.error("getBucketLabelsByIds failed", {
        count: safeBucketIds.length,
        error: (error as Error).message,
      });
      return [];
    }
  }
}

let bucketStoreInstance: BucketStore | null = null;

export function getBucketStore(): BucketStore {
  if (!bucketStoreInstance) {
    bucketStoreInstance = new BucketStore();
  }

  return bucketStoreInstance;
}