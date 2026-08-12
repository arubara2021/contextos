import {
  type RelationshipCreateParams,
  parseRelationshipType,
  validateConfidence,
  deduplicateRelationships,
  isValidRelationshipPair,
} from "../models/relationship.model";
import type { Concept } from "../models/concept.model";
import type { RawConceptFromAI } from "../agent/bedrock-client";
import config from "../config";
import logger from "../utils/logger";

export interface RelationshipStoreWriter {
  createRelationship(params: RelationshipCreateParams): Promise<void>;
}

export interface BucketLookup {
  getBucketIdByNormalized(normalized: string): Promise<string | null>;
  getCanonical(bucketId: string): Promise<string | null>;
  getDefinition(bucketId: string): Promise<string | null>;
}

export interface SimilaritySearchResult {
  bucketId: string;
  similarity: number;
}

export interface SimilaritySearcher {
  searchSimilar(
    vector: number[],
    limit: number
  ): Promise<SimilaritySearchResult[]>;
}

export interface RelationshipMappingResult {
  relationships: RelationshipCreateParams[];
  stored: number;
  mappingTimeMs: number;
}

function normalizeForComparison(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export class RelationshipMapper {
  private readonly store: RelationshipStoreWriter;
  private readonly bucketLookup: BucketLookup;

  constructor(store: RelationshipStoreWriter, bucketLookup: BucketLookup) {
    this.store = store;
    this.bucketLookup = bucketLookup;
  }

  async mapFromExtraction(
    rawConcepts: RawConceptFromAI[],
    concepts: Concept[]
  ): Promise<RelationshipMappingResult> {
    const start = Date.now();
    const relationships: RelationshipCreateParams[] = [];
    const normalizedToCanonical = new Map<string, string>();

    for (const concept of concepts) {
      const normalized = normalizeForComparison(concept.label);
      if (normalized.length > 0) {
        normalizedToCanonical.set(normalized, concept.label);
      }
    }

    for (const raw of rawConcepts) {
      if (typeof raw.label !== "string" || !Array.isArray(raw.related)) continue;
      const sourceLabel = raw.label as string;
      const sourceNormalized = normalizeForComparison(sourceLabel);
      if (sourceNormalized.length === 0) continue;
      if (!normalizedToCanonical.has(sourceNormalized)) continue;
      const sourceCanonical = normalizedToCanonical.get(sourceNormalized) as string;
      const definition =
        typeof raw.definition === "string" ? (raw.definition as string) : "";

      for (const relatedItem of raw.related) {
        if (typeof relatedItem !== "string") continue;
        const targetNormalized = normalizeForComparison(relatedItem);
        if (targetNormalized.length === 0) continue;
        if (targetNormalized === sourceNormalized) continue;
        if (!normalizedToCanonical.has(targetNormalized)) continue;
        const targetCanonical = normalizedToCanonical.get(
          targetNormalized
        ) as string;
        if (!isValidRelationshipPair(sourceCanonical, targetCanonical)) continue;
        relationships.push({
          sourceBucket: sourceCanonical,
          targetBucket: targetCanonical,
          relationType: "related_to",
          confidence: config.relationship.crossChunkConfidence,
          sourceText: definition.substring(0, 500),
        });
      }
    }

    const deduplicated = deduplicateRelationships(relationships);
    let stored = 0;
    for (const rel of deduplicated) {
      try {
        await this.store.createRelationship(rel);
        stored++;
      } catch {
        /* duplicate or constraint violation */
      }
    }

    logger.debug("Relationship mapping from extraction complete", {
      rawRelationships: relationships.length,
      deduplicated: deduplicated.length,
      stored,
      durationMs: Date.now() - start,
    });
    return {
      relationships: deduplicated,
      stored,
      mappingTimeMs: Date.now() - start,
    };
  }

  async discoverCrossDocument(
    concepts: Concept[],
    searcher: SimilaritySearcher
  ): Promise<RelationshipMappingResult> {
    const start = Date.now();
    const relationships: RelationshipCreateParams[] = [];
    for (const concept of concepts) {
      if (!concept.embedding) continue;
      let similar: SimilaritySearchResult[];
      try {
        similar = await searcher.searchSimilar(concept.embedding, 5);
      } catch {
        continue;
      }
      for (const match of similar) {
        if (match.similarity <= config.relationship.similarityMin) continue;
        if (match.similarity >= config.relationship.similarityMax) continue;
        let targetCanonical: string | null = null;
        try {
          targetCanonical = await this.bucketLookup.getCanonical(match.bucketId);
        } catch {
          continue;
        }
        if (!targetCanonical) continue;
        if (
          normalizeForComparison(concept.label) ===
          normalizeForComparison(targetCanonical)
        )
          continue;
        const sourceNormalized = normalizeForComparison(concept.label);
        const targetNormalized = normalizeForComparison(targetCanonical);
        if (sourceNormalized === targetNormalized) continue;
        relationships.push({
          sourceBucket: concept.label,
          targetBucket: targetCanonical,
          relationType: "related_to",
          confidence: validateConfidence(
            match.similarity * config.relationship.crossChunkConfidence
          ),
          sourceText: concept.definition.substring(0, 500),
        });
      }
    }
    const deduplicated = deduplicateRelationships(relationships);
    let stored = 0;
    for (const rel of deduplicated) {
      try {
        await this.store.createRelationship(rel);
        stored++;
      } catch {
        /* duplicate or constraint violation */
      }
    }
    logger.debug("Cross-document relationship discovery complete", {
      discovered: relationships.length,
      deduplicated: deduplicated.length,
      stored,
      durationMs: Date.now() - start,
    });
    return {
      relationships: deduplicated,
      stored,
      mappingTimeMs: Date.now() - start,
    };
  }

  async mapRelationships(
    concepts: Concept[],
    sourceText: string
  ): Promise<RelationshipMappingResult> {
    logger.warn(
      "mapRelationships(concepts, sourceText) is deprecated. Use mapFromExtraction or discoverCrossDocument instead."
    );
    return {
      relationships: [],
      stored: 0,
      mappingTimeMs: 0,
    };
  }
}

let mapperInstance: RelationshipMapper | null = null;

export function getRelationshipMapper(
  store: RelationshipStoreWriter,
  bucketLookup: BucketLookup
): RelationshipMapper {
  if (!mapperInstance) {
    mapperInstance = new RelationshipMapper(store, bucketLookup);
  }
  return mapperInstance;
}