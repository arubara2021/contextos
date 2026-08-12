export type RelationshipType =
  | "causes"
  | "related_to"
  | "replaces"
  | "part_of"
  | "requires"
  | "evolves_into";

export const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  "causes",
  "related_to",
  "replaces",
  "part_of",
  "requires",
  "evolves_into",
];

export function isRelationshipType(value: string): value is RelationshipType {
  return (RELATIONSHIP_TYPES as readonly string[]).includes(value);
}

export function parseRelationshipType(value: string): RelationshipType | null {
  const normalized = value.toLowerCase().trim().replace(/\s+/g, "_");
  if (isRelationshipType(normalized)) {
    return normalized;
  }
  return null;
}

export interface RelationshipRow {
  relationship_id: string;
  source_bucket: string;
  target_bucket: string;
  relation_type: string;
  confidence: number;
  source_text: string | null;
  created_at: Date;
}

export interface Relationship {
  relationshipId: string;
  sourceBucket: string;
  targetBucket: string;
  relationType: RelationshipType;
  confidence: number;
  sourceText: string | null;
  createdAt: Date;
}

export interface RelationshipWithMeta extends Relationship {
  connectedBucketId: string;
  connectedBucketName?: string;
  connectedBucketType?: string;
  direction: "outgoing" | "incoming";
}

export interface RelationshipCreateParams {
  sourceBucket: string;
  targetBucket: string;
  relationType: RelationshipType;
  confidence?: number;
  sourceText?: string;
}

export function mapRowToRelationship(row: RelationshipRow): Relationship {
  return {
    relationshipId: row.relationship_id,
    sourceBucket: row.source_bucket,
    targetBucket: row.target_bucket,
    relationType: row.relation_type as RelationshipType,
    confidence: Number(row.confidence),
    sourceText: row.source_text,
    createdAt: new Date(row.created_at),
  };
}

export function mapRowToRelationshipWithMeta(
  row: RelationshipRow & {
    connected_bucket_name?: string;
    connected_bucket_type?: string;
  },
  currentBucketId: string
): RelationshipWithMeta {
  const base = mapRowToRelationship(row);
  const isOutgoing = base.sourceBucket === currentBucketId;
  return {
    ...base,
    connectedBucketId: isOutgoing ? base.targetBucket : base.sourceBucket,
    connectedBucketName: row.connected_bucket_name,
    connectedBucketType: row.connected_bucket_type,
    direction: isOutgoing ? "outgoing" : "incoming",
  };
}

export function validateConfidence(value: unknown): number {
  const num = Number(value);
  if (Number.isNaN(num)) return 0.5;
  if (num < 0) return 0;
  if (num > 1) return 1;
  return num;
}

export function relationshipExists(
  relationships: Relationship[],
  sourceBucket: string,
  targetBucket: string,
  relationType: RelationshipType
): boolean {
  return relationships.some(
    (r) =>
      r.sourceBucket === sourceBucket &&
      r.targetBucket === targetBucket &&
      r.relationType === relationType
  );
}

export function deduplicateRelationships(params: RelationshipCreateParams[]): RelationshipCreateParams[] {
  const seen = new Set<string>();
  const deduplicated: RelationshipCreateParams[] = [];

  for (const param of params) {
    const key = `${param.sourceBucket}:${param.targetBucket}:${param.relationType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(param);
  }

  return deduplicated;
}

export function isValidRelationshipPair(sourceId: string, targetId: string): boolean {
  return sourceId !== targetId && sourceId.length > 0 && targetId.length > 0;
}

export function strengthenConfidence(currentConfidence: number, boost: number = 0.05): number {
  return Math.min(1.0, currentConfidence + boost);
}