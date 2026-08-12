import type { ConceptType } from "./concept.model";

export interface BucketItemRow {
  item_id: string;
  bucket_id: string;
  label: string;
  definition: string | null;
  source: string | null;
  timestamp: Date;
}

export interface BucketRow {
  bucket_id: string;
  canonical: string;
  normalized: string;
  strength: number;
  importance: number;
  concept_type: string;
  last_accessed: Date;
  access_count: number;
  decay_rate: number;
  created_at: Date;
  document_id: string | null;
}

export interface Bucket {
  bucketId: string;
  canonical: string;
  normalized: string;
  strength: number;
  importance: number;
  conceptType: ConceptType;
  lastAccessed: Date;
  accessCount: number;
  decayRate: number;
  createdAt: Date;
  documentId: string | null;
  items: BucketItem[];
}

export interface BucketItem {
  itemId: string;
  bucketId: string;
  label: string;
  definition: string | null;
  source: string | null;
  timestamp: Date;
}

export interface BucketWithItems {
  bucket: Bucket;
  items: BucketItem[];
}

export interface BucketCreateParams {
  canonical: string;
  normalized: string;
  strength?: number;
  importance: number;
  conceptType: ConceptType;
  decayRate: number;
  itemLabel: string;
  itemDefinition?: string;
  itemSource?: string;
  documentId?: string | null;
}

export interface BucketUpdateParams {
  canonical?: string;
  importance?: number;
  conceptType?: ConceptType;
  strength?: number;
  decayRate?: number;
}

export interface BucketFilters {
  conceptType?: ConceptType;
  minStrength?: number;
  maxStrength?: number;
  search?: string;
  documentId?: string;
  limit?: number;
  offset?: number;
}

export function mapRowToBucket(row: BucketRow): Bucket {
  return {
    bucketId: row.bucket_id,
    canonical: row.canonical,
    normalized: row.normalized,
    strength: Number(row.strength),
    importance: Number(row.importance),
    conceptType: row.concept_type as ConceptType,
    lastAccessed: new Date(row.last_accessed),
    accessCount: Number(row.access_count),
    decayRate: Number(row.decay_rate),
    createdAt: new Date(row.created_at),
    documentId: row.document_id ?? null,
    items: [],
  };
}

export function mapRowToBucketItem(row: BucketItemRow): BucketItem {
  return {
    itemId: row.item_id,
    bucketId: row.bucket_id,
    label: row.label,
    definition: row.definition,
    source: row.source,
    timestamp: new Date(row.timestamp),
  };
}

export function mapRowToBucketWithItems(bucketRow: BucketRow, itemRows: BucketItemRow[]): BucketWithItems {
  return {
    bucket: mapRowToBucket(bucketRow),
    items: itemRows.map(mapRowToBucketItem),
  };
}

export function bucketToPlainObject(bucket: Bucket): Record<string, unknown> {
  return {
    bucketId: bucket.bucketId,
    canonical: bucket.canonical,
    normalized: bucket.normalized,
    strength: bucket.strength,
    importance: bucket.importance,
    conceptType: bucket.conceptType,
    lastAccessed: bucket.lastAccessed.toISOString(),
    accessCount: bucket.accessCount,
    decayRate: bucket.decayRate,
    createdAt: bucket.createdAt.toISOString(),
    documentId: bucket.documentId,
    itemCount: bucket.items.length,
  };
}

export function buildBucketUpdateSet(params: BucketUpdateParams): {
  clauses: string;
  values: unknown[];
} {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (params.canonical !== undefined) {
    fields.push(`canonical = $$$${idx++}`);
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

export function buildBucketFilterWhere(filters: BucketFilters): {
  clauses: string;
  values: unknown[];
} {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (filters.conceptType) {
    conditions.push(`concept_type = $${idx++}`);
    values.push(filters.conceptType);
  }
  if (filters.minStrength !== undefined) {
    conditions.push(`strength >= $${idx++}`);
    values.push(filters.minStrength);
  }
  if (filters.maxStrength !== undefined) {
    conditions.push(`strength <= $${idx++}`);
    values.push(filters.maxStrength);
  }
  if (filters.documentId) {
    conditions.push(`document_id = $${idx++}`);
    values.push(filters.documentId);
  }
  if (filters.search) {
    conditions.push(`(canonical ILIKE $${idx} OR bucket_id IN (SELECT bucket_id FROM bucket_items WHERE label ILIKE $${idx} OR definition ILIKE $${idx}))`);
    values.push(`%${filters.search}%`);
    idx++;
  }

  return {
    clauses: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    values,
  };
}