import { queryMany, queryOne } from "../database";
import config from "../config";
import { getScorer } from "./scorer";
import type { ScoredCandidate } from "./scorer";
import logger from "../utils/logger";

export interface RetrievalConnectivityMeta {
  score: number;
  degree: number;
  crossDocumentDegree: number;
  avgConfidence: number;
  connectedToCurrentDocument: boolean;
  connectedToRecent: boolean;
}

export interface RetrievalCandidate {
  bucketId: string;
  canonical: string;
  definition: string | null;
  significance: string | null;
  conceptType: string;
  importance: number;
  strength: number;
  lastAccessed: Date | null;
  accessCount: number;
  decayRate: number;
  sources: string[];
  documentId: string | null;
  connectivity?: RetrievalConnectivityMeta;
  scores: {
    vectorScore: number;
    textScore: number;
    graphScore: number;
  };
}

export interface EmbeddingSearcher {
  generateEmbedding(text: string): Promise<number[]>;
  searchSimilar(
    vector: number[],
    limit: number
  ): Promise<Array<{ bucketId: string; similarity: number }>>;
  searchSimilarWithinDocument?(
    vector: number[],
    documentId: string,
    limit: number
  ): Promise<Array<{ bucketId: string; similarity: number }>>;
}

export interface TextSearcher {
  searchBuckets(
    searchTerm: string,
    limit: number,
    userId?: string | null
  ): Promise<
    Array<{
      bucket_id?: string;
      bucketId?: string;
      canonical?: string;
      strength?: number;
      importance?: number;
      concept_type?: string;
      conceptType?: string;
      last_accessed?: Date;
      access_count?: number;
      decay_rate?: number;
    }>
  >;
}

export interface GraphSearcher {
  getBySource(
    sourceBucket: string
  ): Promise<
    Array<{
      source_bucket: string;
      target_bucket: string;
      relation_type: string;
      confidence: number;
    }>
  >;
  getByTarget(
    targetBucket: string
  ): Promise<
    Array<{
      source_bucket: string;
      target_bucket: string;
      relation_type: string;
      confidence: number;
    }>
  >;
}

export interface QuerySpec {
  keyTerms: string[];
  expandedTerms: string[];
  intent: string;
  domain: string;
  specificity: number;
  preferredTypes: string[];
  isAbstractQuery: boolean;
  documentScoped?: boolean;
  currentDocumentId?: string;
  recentBucketIds?: string[];
  isChitchat?: boolean;
}

interface DirectMatch {
  bucketId: string;
  vectorSimilarity: number;
  textMatch: boolean;
}

interface GraphExpansion {
  bucketId: string;
  viaRelation: string;
  confidence: number;
}

interface MergedCandidate {
  bucketId: string;
  vectorSimilarity: number;
  textMatch: boolean;
  graphConnectionCount: number;
}

interface BucketRow {
  bucket_id: string;
  canonical: string;
  strength: number;
  importance: number;
  concept_type: string;
  last_accessed: Date | null;
  access_count: number;
  decay_rate: number;
  document_id: string | null;
  user_id: string | null;
}

interface BucketItemRow {
  bucket_id: string;
  label: string;
  definition: string | null;
  source: string | null;
}

interface ConnectivityEdgeRow {
  source_bucket_id: string;
  target_bucket_id: string;
  confidence: number;
  source_document_id: string | null;
  target_document_id: string | null;
}

interface ConnectivityAggregate {
  others: Set<string>;
  crossDocs: Set<string>;
  confidences: number[];
  edgeToCurrent: boolean;
  edgeToRecent: boolean;
}

const GLOBAL_MIN_SIMILARITY = 0.15;
const SCOPED_MIN_SIMILARITY = 0.2;
const GRAPH_SEED_LIMIT = 12;
const GRAPH_NEIGHBOR_LIMIT = 40;
const HIGH_IMPORTANCE_FALLBACK_LIMIT = 12;
const MAX_TOTAL_CANDIDATES = 80;

const OVERVIEW_LABEL_TERMS = [
  "overview",
  "summary",
  "introduction",
  "abstract",
  "preface",
  "what this",
];

const RESULTS_QUERY_PATTERN =
  /(result|results|metric|metrics|performance|benchmark|evaluation|outcome|outcomes|findings|throughput|latency|accuracy|speedup|improvement|baseline|comparison|experiment|table)/i;

const MAIN_QUERY_PATTERN =
  /(main contribution|contribution|contributions|main idea|main point|main topic|what is this|what does this|about|purpose|thesis|novel|proposes|introduces|presents|core idea|primary)/i;

const PROBLEM_QUERY_PATTERN =
  /(problem|issue|challenge|gap|limitation|solve|solves|address|addresses|bottleneck|inefficiency|overhead)/i;

const RESULTS_TARGET_TERMS = [
  "results",
  "result",
  "metrics",
  "metric",
  "performance",
  "benchmark",
  "evaluation",
  "outcome",
  "findings",
  "throughput",
  "latency",
  "accuracy",
  "speedup",
  "improvement",
  "baseline",
  "comparison",
  "experiment",
];

const MAIN_TARGET_TERMS = [
  "contribution",
  "contributions",
  "main",
  "novel",
  "proposes",
  "introduces",
  "presents",
  "primary",
  "core",
  "thesis",
  "purpose",
  "architecture",
  "system",
  "method",
  "module",
  "framework",
];

const PROBLEM_TARGET_TERMS = [
  "problem",
  "issue",
  "challenge",
  "gap",
  "limitation",
  "solve",
  "solves",
  "address",
  "addresses",
  "bottleneck",
  "inefficiency",
  "overhead",
];

function clampUnit(value: unknown): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function uniqueTerms(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const cleaned = String(value ?? "")
      .toLowerCase()
      .replace(/[%_\\]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!cleaned || cleaned.length < 2) continue;
    if (seen.has(cleaned)) continue;

    seen.add(cleaned);
    result.push(cleaned);
  }

  return result;
}

export class Retriever {
  private readonly embeddingSearcher: EmbeddingSearcher;
  private readonly textSearcher: TextSearcher;
  private readonly graphSearcher: GraphSearcher;
  private readonly embeddingCache: Map<
    string,
    { vector: number[]; timestamp: number }
  > = new Map();
  private readonly cacheTtlMs = 5 * 60 * 1000;
  private readonly maxCacheSize = 1000;
  private relationshipStore: any | null = null;

  constructor(deps: {
    embeddingSearcher: EmbeddingSearcher;
    textSearcher: TextSearcher;
    graphSearcher: GraphSearcher;
  }) {
    this.embeddingSearcher = deps.embeddingSearcher;
    this.textSearcher = deps.textSearcher;
    this.graphSearcher = deps.graphSearcher;
  }

  async retrieve(
    querySpec: QuerySpec,
    documentId?: string,
    userId?: string | null
  ): Promise<ScoredCandidate[]> {
    const start = Date.now();

    if (querySpec.isChitchat || querySpec.intent === "chitchat") {
      return [];
    }

    let resolvedUserId = userId ?? null;

    if (!resolvedUserId && documentId) {
      resolvedUserId = await this.resolveUserIdFromDocument(documentId);
    }

    const allTerms = [
      ...querySpec.keyTerms,
      ...(querySpec.expandedTerms || []),
    ];

    const targetedTerms = this.buildTargetedTerms(querySpec);

    const textTerms = uniqueTerms([...allTerms, ...targetedTerms]).slice(0, 12);

    const queryText =
      allTerms.length > 0 ? allTerms.join(" ") : querySpec.keyTerms.join(" ");

    const searchLimit = documentId ? 30 : 20;

    let vectorResults: Array<{ bucketId: string; similarity: number }> = [];
    let textResults: any[] = [];

    if (documentId) {
      const scopedResults = resolvedUserId
        ? await this.vectorSearchUser(
          queryText,
          resolvedUserId,
          documentId,
          searchLimit
        )
        : await this.vectorSearchScoped(queryText, documentId, searchLimit);

      const floored = scopedResults.filter(
        (r) => r.similarity >= SCOPED_MIN_SIMILARITY
      );

      let usedScoped = floored;

      if (usedScoped.length === 0) {
        if (querySpec.isAbstractQuery || targetedTerms.length > 0) {
          usedScoped = scopedResults.slice(0, 10);
        } else {
          return [];
        }
      }

      vectorResults = usedScoped;

      textResults = await this.textSearchUser(
        textTerms,
        25,
        resolvedUserId,
        documentId
      );
    } else {
      if (resolvedUserId) {
        vectorResults = await this.vectorSearchUser(
          queryText,
          resolvedUserId,
          undefined,
          searchLimit
        );

        textResults = await this.textSearchUser(
          textTerms,
          25,
          resolvedUserId,
          undefined
        );
      } else {
        vectorResults = await this.vectorSearch(queryText, searchLimit);
        textResults = await this.textSearch(textTerms, 20);
      }

      vectorResults = vectorResults.filter(
        (r) => r.similarity >= GLOBAL_MIN_SIMILARITY
      );
    }

    const directMatches = this.mergeDirectResults(vectorResults, textResults);

    const recentSeedIds = this.buildRecentSeedIds(querySpec, directMatches);

    const wantOverview = this.shouldTryOverviewFallback(
      querySpec,
      directMatches,
      documentId,
      targetedTerms
    );

    const [overviewHits, graphExpanded] = await Promise.all([
      wantOverview
        ? this.overviewFallbackSearch(documentId, resolvedUserId)
        : Promise.resolve(
          [] as Array<{
            bucketId: string;
            vectorSimilarity: number;
            textMatch: boolean;
          }>
        ),
      this.graphExpand(directMatches, resolvedUserId, recentSeedIds),
    ]);

    for (const hit of overviewHits) {
      if (!directMatches.has(hit.bucketId)) {
        directMatches.set(hit.bucketId, {
          bucketId: hit.bucketId,
          vectorSimilarity: hit.vectorSimilarity,
          textMatch: hit.textMatch,
        });
      }
    }

    const baseCandidates = this.mergeAllResults(directMatches, graphExpanded);

    const highImportanceCandidates =
      querySpec.isAbstractQuery || targetedTerms.length > 0
        ? await this.highImportanceCandidates(
          querySpec,
          documentId,
          resolvedUserId
        )
        : [];

    const candidateMap = new Map<string, MergedCandidate>();

    for (const candidate of baseCandidates) {
      candidateMap.set(candidate.bucketId, candidate);
    }

    for (const candidate of highImportanceCandidates) {
      if (!candidateMap.has(candidate.bucketId)) {
        candidateMap.set(candidate.bucketId, candidate);
      }
    }

    const allCandidates = Array.from(candidateMap.values())
      .sort((a, b) => {
        const scoreA =
          a.vectorSimilarity +
          (a.textMatch ? 0.25 : 0) +
          a.graphConnectionCount * 0.05;

        const scoreB =
          b.vectorSimilarity +
          (b.textMatch ? 0.25 : 0) +
          b.graphConnectionCount * 0.05;

        return scoreB - scoreA;
      })
      .slice(0, MAX_TOTAL_CANDIDATES);

    const bucketIds = allCandidates.map((c) => c.bucketId);

    const [bucketRows, itemRows] = await Promise.all([
      this.batchGetBuckets(bucketIds, resolvedUserId),
      this.batchGetItems(bucketIds),
    ]);

    const bucketMap = new Map<string, BucketRow>();

    for (const row of bucketRows) {
      bucketMap.set(row.bucket_id, row);
    }

    const itemMap = new Map<string, BucketItemRow[]>();

    for (const row of itemRows) {
      const existing = itemMap.get(row.bucket_id) || [];
      existing.push(row);
      itemMap.set(row.bucket_id, existing);
    }

    const now = Date.now();
    const candidates: RetrievalCandidate[] = [];

    for (const merged of allCandidates) {
      const bucket = bucketMap.get(merged.bucketId);

      if (!bucket) continue;

      if (resolvedUserId && bucket.user_id !== resolvedUserId) {
        continue;
      }

      if (
        documentId &&
        bucket.document_id !== documentId &&
        merged.graphConnectionCount === 0
      ) {
        continue;
      }

      const items = itemMap.get(merged.bucketId) || [];

      const sources = [
        ...new Set(
          items
            .map((i) => i.source)
            .filter((s): s is string => typeof s === "string")
        ),
      ];

      const lastAccessed = bucket.last_accessed
        ? new Date(bucket.last_accessed)
        : null;

      const daysSinceAccess = lastAccessed
        ? (now - lastAccessed.getTime()) / (1000 * 60 * 60 * 24)
        : 999;

      const importance = bucket.importance ?? 5;

      let effectiveRate = config.decay.defaultRate;

      if (importance >= 8) effectiveRate = config.decay.highImportanceRate;
      else if (importance <= 3) effectiveRate = config.decay.lowImportanceRate;

      const currentStrength =
        (bucket.strength ?? 0.5) *
        Math.pow(1 - effectiveRate, daysSinceAccess);

      if (!documentId && currentStrength < config.memory.forgottenThreshold) {
        continue;
      }

      const bestItem =
        items.length > 0
          ? items.reduce(
            (best, item) =>
              (item.definition?.length || 0) >
                (best.definition?.length || 0)
                ? item
                : best,
            items[0]
          )
          : null;

      const bestDefinition = bestItem?.definition ?? null;

      candidates.push({
        bucketId: merged.bucketId,
        canonical: bucket.canonical ?? "",
        definition: bestDefinition,
        significance: bestDefinition,
        conceptType: bucket.concept_type ?? "fact",
        importance,
        strength: Math.max(0, Math.min(1, currentStrength)),
        lastAccessed,
        accessCount: bucket.access_count ?? 0,
        decayRate: effectiveRate,
        sources,
        documentId: bucket.document_id ?? null,
        scores: {
          vectorScore: clampUnit(merged.vectorSimilarity),
          textScore: merged.textMatch ? 1.0 : 0.0,
          graphScore: Math.min(1, merged.graphConnectionCount * 0.25),
        },
      });
    }

    const connectivityMap = await this.batchGetConnectivity(
      candidates.map((c) => c.bucketId),
      resolvedUserId,
      documentId,
      recentSeedIds,
      bucketMap
    );

    for (const candidate of candidates) {
      candidate.connectivity =
        connectivityMap.get(candidate.bucketId) ??
        this.fallbackConnectivity(candidate, documentId, recentSeedIds);
    }

    const filteredCandidates = candidates.filter((candidate) => {
      if (!documentId) return true;

      if (candidate.documentId === documentId) return true;

      if (!candidate.connectivity?.connectedToCurrentDocument) {
        if (
          candidate.scores.vectorScore === 0 &&
          candidate.scores.textScore === 0
        ) {
          return false;
        }
      }

      return true;
    });

    const effectiveQuerySpec: QuerySpec = {
      ...querySpec,
      documentScoped: Boolean(documentId || querySpec.documentScoped),
      currentDocumentId: documentId ?? querySpec.currentDocumentId,
      recentBucketIds: recentSeedIds,
    };

    const scorer = getScorer();
    const { scored } = scorer.score(filteredCandidates, effectiveQuerySpec);

    const results = scored.slice(0, config.memory.maxContextMemories);

    logger.debug("Retrieval complete", {
      queryTerms: querySpec.keyTerms.length,
      expandedTerms: (querySpec.expandedTerms || []).length,
      targetedTerms: targetedTerms.length,
      isAbstractQuery: querySpec.isAbstractQuery,
      documentScoped: Boolean(effectiveQuerySpec.documentScoped),
      userId: resolvedUserId,
      vectorHits: vectorResults.length,
      textHits: textResults.length,
      graphExpanded: graphExpanded.length,
      highImportanceFallback: highImportanceCandidates.length,
      totalCandidates: filteredCandidates.length,
      returned: results.length,
      durationMs: Date.now() - start,
    });

    return results;
  }

  private async getRelationshipStoreInstance(): Promise<any | null> {
    if (this.relationshipStore) return this.relationshipStore;

    try {
      const mod = await import("../storage/relationship-store");
      this.relationshipStore = mod.getRelationshipStore();
      return this.relationshipStore;
    } catch {
      return null;
    }
  }

  private async resolveUserIdFromDocument(
    documentId: string
  ): Promise<string | null> {
    try {
      const row = await queryOne<{ user_id: string | null }>(
        "SELECT user_id FROM documents WHERE document_id = $1",
        [documentId]
      );

      return row?.user_id ?? null;
    } catch {
      return null;
    }
  }

  private evictOldestCacheEntry(): void {
    if (this.embeddingCache.size >= this.maxCacheSize) {
      const oldestKey = this.embeddingCache.keys().next().value;

      if (oldestKey !== undefined) {
        this.embeddingCache.delete(oldestKey);
      }
    }
  }

  private async embedOnce(text: string, cacheKey: string): Promise<number[]> {
    const trimmed = text?.trim() ?? "";

    if (trimmed.length < 2) return [];

    const cached = this.embeddingCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp <= this.cacheTtlMs) {
      return cached.vector;
    }

    const vector = await this.embeddingSearcher.generateEmbedding(trimmed);

    this.evictOldestCacheEntry();
    this.embeddingCache.set(cacheKey, { vector, timestamp: Date.now() });

    return vector;
  }

  private serializeVector(vector: number[]): string {
    return `[${vector.join(",")}]`;
  }

  private buildTargetedTerms(querySpec: QuerySpec): string[] {
    const text = [
      ...querySpec.keyTerms,
      ...(querySpec.expandedTerms || []),
    ]
      .join(" ")
      .toLowerCase();

    const terms = new Set<string>();

    if (RESULTS_QUERY_PATTERN.test(text)) {
      for (const term of RESULTS_TARGET_TERMS) terms.add(term);
    }

    if (MAIN_QUERY_PATTERN.test(text)) {
      for (const term of MAIN_TARGET_TERMS) terms.add(term);
    }

    if (PROBLEM_QUERY_PATTERN.test(text)) {
      for (const term of PROBLEM_TARGET_TERMS) terms.add(term);
    }

    return Array.from(terms).slice(0, 12);
  }

  private async vectorSearchUser(
    queryText: string,
    userId: string,
    documentId: string | undefined,
    limit: number
  ): Promise<Array<{ bucketId: string; similarity: number }>> {
    try {
      const cacheKey = documentId
        ? `user:${userId}:scoped:${documentId}:${queryText.toLowerCase().trim()}`
        : `user:${userId}:${queryText.toLowerCase().trim()}`;

      const vector = await this.embedOnce(queryText, cacheKey);

      if (!vector || vector.length === 0) return [];

      const serialized = this.serializeVector(vector);

      const rows = documentId
        ? await queryMany<{ bucket_id: string; similarity: number }>(
          `SELECT e.bucket_id,
                    1 - (e.vector <=> $1::vector) AS similarity
             FROM embeddings e
             JOIN buckets b ON b.bucket_id = e.bucket_id
             WHERE b.user_id = $2
               AND b.document_id = $3
             ORDER BY e.vector <=> $1::vector
             LIMIT $4`,
          [serialized, userId, documentId, limit]
        )
        : await queryMany<{ bucket_id: string; similarity: number }>(
          `SELECT e.bucket_id,
                    1 - (e.vector <=> $1::vector) AS similarity
             FROM embeddings e
             JOIN buckets b ON b.bucket_id = e.bucket_id
             WHERE b.user_id = $2
             ORDER BY e.vector <=> $1::vector
             LIMIT $3`,
          [serialized, userId, limit]
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
      logger.warn("User-scoped vector search failed", {
        userId,
        documentId,
        error: (error as Error).message,
      });

      return [];
    }
  }

  private async vectorSearch(
    queryText: string,
    limit: number
  ): Promise<Array<{ bucketId: string; similarity: number }>> {
    try {
      const cacheKey = queryText.toLowerCase().trim();
      const vector = await this.embedOnce(queryText, cacheKey);

      if (!vector || vector.length === 0) return [];

      return await this.embeddingSearcher.searchSimilar(vector, limit);
    } catch (error) {
      logger.warn("Vector search failed", {
        error: (error as Error).message,
      });

      return [];
    }
  }

  private async vectorSearchScoped(
    queryText: string,
    documentId: string,
    limit: number
  ): Promise<Array<{ bucketId: string; similarity: number }>> {
    try {
      const cacheKey = `scoped:${documentId}:${queryText.toLowerCase().trim()}`;
      const vector = await this.embedOnce(queryText, cacheKey);

      if (!vector || vector.length === 0) return [];

      if (this.embeddingSearcher.searchSimilarWithinDocument) {
        return await this.embeddingSearcher.searchSimilarWithinDocument(
          vector,
          documentId,
          limit
        );
      }

      return [];
    } catch (error) {
      logger.warn("Scoped vector search failed", {
        documentId,
        error: (error as Error).message,
      });

      return [];
    }
  }

  private async textSearchUser(
    terms: string[],
    limit: number,
    userId: string | null,
    documentId?: string
  ): Promise<any[]> {
    const cleanTerms = uniqueTerms(terms).slice(0, 10);

    if (cleanTerms.length === 0) return [];

    if (!userId) {
      return this.textSearch(cleanTerms, limit);
    }

    try {
      const values: unknown[] = [userId];
      let idx = 2;

      if (documentId) {
        values.push(documentId);
        idx++;
      }

      const ors: string[] = [];

      for (const term of cleanTerms) {
        values.push(`%${term}%`);
        ors.push(
          `(b.canonical ILIKE $${idx} OR bi.label ILIKE $${idx} OR bi.definition ILIKE $${idx})`
        );
        idx++;
      }

      const where: string[] = [`b.user_id = $1`];

      if (documentId) {
        where.push(`b.document_id = $2`);
      }

      where.push(`(${ors.join(" OR ")})`);

      values.push(limit);

      const rows = await queryMany<{ bucket_id: string }>(
        `SELECT b.bucket_id
         FROM buckets b
         LEFT JOIN bucket_items bi ON bi.bucket_id = b.bucket_id
         WHERE ${where.join(" AND ")}
         GROUP BY b.bucket_id
         ORDER BY MAX(b.importance) DESC, MAX(b.strength) DESC
         LIMIT $${idx}`,
        values
      );

      return rows;
    } catch (error) {
      logger.debug("textSearchUser failed, falling back", {
        userId,
        documentId,
        error: (error as Error).message,
      });

      return this.textSearch(cleanTerms, limit, userId);
    }
  }

  private async callTextSearch(
    term: string,
    limit: number,
    userId?: string | null
  ): Promise<any[]> {
    try {
      return await this.textSearcher.searchBuckets(term, limit, userId);
    } catch {
      return [];
    }
  }

  private async textSearch(
    keyTerms: string[],
    limit: number,
    userId?: string | null
  ): Promise<any[]> {
    const results: any[] = [];
    const seen = new Set<string>();

    const searchTerms = uniqueTerms(keyTerms).slice(0, 10);

    if (searchTerms.length === 0) return results;

    const termResults = await Promise.allSettled(
      searchTerms.map((term) =>
        this.callTextSearch(
          term,
          Math.ceil(limit / searchTerms.length),
          userId
        )
      )
    );

    for (const result of termResults) {
      if (result.status !== "fulfilled") continue;

      for (const match of result.value) {
        const id = match.bucket_id ?? match.bucketId ?? "";

        if (id && !seen.has(id)) {
          seen.add(id);
          results.push(match);
        }
      }
    }

    return results;
  }

  private shouldTryOverviewFallback(
    querySpec: QuerySpec,
    directMatches: Map<string, DirectMatch>,
    documentId?: string,
    targetedTerms?: string[]
  ): boolean {
    if (documentId && !querySpec.isAbstractQuery) return false;

    if (!querySpec.isAbstractQuery && querySpec.specificity >= 0.5) {
      return false;
    }

    if (directMatches.size === 0) return true;

    if (targetedTerms && targetedTerms.length > 0 && directMatches.size < 6) {
      return true;
    }

    const queryLower = [
      ...querySpec.keyTerms,
      ...(querySpec.expandedTerms || []),
    ]
      .join(" ")
      .toLowerCase();

    const hasOverviewTerms = OVERVIEW_LABEL_TERMS.some((term) =>
      queryLower.includes(term)
    );

    if (hasOverviewTerms) return true;

    if (querySpec.isAbstractQuery && directMatches.size < 8) return true;

    return false;
  }

  private async overviewFallbackSearch(
    documentId?: string,
    userId?: string | null
  ): Promise<
    Array<{
      bucketId: string;
      vectorSimilarity: number;
      textMatch: boolean;
    }>
  > {
    const hits = await this.textSearchUser(
      OVERVIEW_LABEL_TERMS,
      10,
      userId ?? null,
      documentId
    );

    const ids = hits
      .map((hit: any) => hit.bucket_id ?? hit.bucketId ?? "")
      .filter((id: string) => id.length > 0);

    if (ids.length === 0) return [];

    const buckets = await this.batchGetBuckets(ids, userId ?? null);

    return buckets
      .filter((bucket) =>
        OVERVIEW_LABEL_TERMS.some((term) =>
          (bucket.canonical || "").toLowerCase().includes(term)
        )
      )
      .map((bucket) => ({
        bucketId: bucket.bucket_id,
        vectorSimilarity: 0,
        textMatch: true,
      }));
  }

  private mergeDirectResults(
    vectorResults: Array<{ bucketId: string; similarity: number }>,
    textResults: any[]
  ): Map<string, DirectMatch> {
    const merged = new Map<string, DirectMatch>();

    for (const vr of vectorResults) {
      merged.set(vr.bucketId, {
        bucketId: vr.bucketId,
        vectorSimilarity: vr.similarity,
        textMatch: false,
      });
    }

    for (const tr of textResults) {
      const id = tr.bucket_id ?? tr.bucketId ?? "";

      if (!id) continue;

      const existing = merged.get(id);

      if (existing) {
        existing.textMatch = true;
      } else {
        merged.set(id, {
          bucketId: id,
          vectorSimilarity: 0,
          textMatch: true,
        });
      }
    }

    return merged;
  }

  private buildRecentSeedIds(
    querySpec: QuerySpec,
    directMatches: Map<string, DirectMatch>
  ): string[] {
    const seeds: string[] = [];
    const seen = new Set<string>();

    const addSeed = (bucketId: string | null | undefined) => {
      if (!bucketId) return;
      if (seen.has(bucketId)) return;

      seen.add(bucketId);
      seeds.push(bucketId);
    };

    if (Array.isArray(querySpec.recentBucketIds)) {
      for (const bucketId of querySpec.recentBucketIds) {
        addSeed(bucketId);
      }
    }

    const directSeeds = Array.from(directMatches.values())
      .sort((a, b) => {
        const scoreA = a.vectorSimilarity + (a.textMatch ? 0.2 : 0);
        const scoreB = b.vectorSimilarity + (b.textMatch ? 0.2 : 0);
        return scoreB - scoreA;
      })
      .slice(0, 8)
      .map((m) => m.bucketId);

    for (const bucketId of directSeeds) {
      addSeed(bucketId);
    }

    return seeds.slice(0, GRAPH_SEED_LIMIT);
  }

  private async graphExpand(
    directMatches: Map<string, DirectMatch>,
    userId?: string | null,
    recentBucketIds?: string[]
  ): Promise<GraphExpansion[]> {
    let seedIds: string[] = [];

    if (Array.isArray(recentBucketIds) && recentBucketIds.length > 0) {
      seedIds = recentBucketIds.slice(0, GRAPH_SEED_LIMIT);
    }

    if (seedIds.length === 0) {
      seedIds = Array.from(directMatches.keys()).slice(0, GRAPH_SEED_LIMIT);
    }

    if (seedIds.length === 0) return [];

    const relationshipStore = await this.getRelationshipStoreInstance();

    if (
      relationshipStore &&
      typeof relationshipStore.expandFromBucketIds === "function"
    ) {
      try {
        const edges = await relationshipStore.expandFromBucketIds(
          seedIds,
          userId,
          GRAPH_NEIGHBOR_LIMIT * 2
        );

        const seedSet = new Set(seedIds);
        const neighborMeta = new Map<
          string,
          { viaRelation: string; confidence: number }
        >();

        for (const edge of edges) {
          const other = seedSet.has(edge.sourceBucketId)
            ? edge.targetBucketId
            : edge.sourceBucketId;

          if (!other || seedSet.has(other)) continue;

          const existing = neighborMeta.get(other);

          if (!existing || edge.confidence > existing.confidence) {
            neighborMeta.set(other, {
              viaRelation: edge.relationType,
              confidence: edge.confidence,
            });
          }

          if (neighborMeta.size >= GRAPH_NEIGHBOR_LIMIT) break;
        }

        return Array.from(neighborMeta.entries()).map(([bucketId, meta]) => ({
          bucketId,
          viaRelation: meta.viaRelation,
          confidence: meta.confidence,
        }));
      } catch (error) {
        logger.warn("ID-based graph expansion failed", {
          error: (error as Error).message,
        });
      }
    }

    return this.graphExpandLegacy(seedIds, userId);
  }

  private async graphExpandLegacy(
    seedIds: string[],
    userId?: string | null
  ): Promise<GraphExpansion[]> {
    try {
      const values: unknown[] = [seedIds];
      let idx = 2;

      let userClause = "";

      if (userId) {
        userClause = `AND (r.user_id = $${idx} OR r.user_id IS NULL)`;
        values.push(userId);
        idx++;
      }

      values.push(GRAPH_NEIGHBOR_LIMIT * 2);

      const rows = await queryMany<{
        source_bucket_id: string;
        target_bucket_id: string;
        relation_type: string;
        confidence: number;
      }>(
        `SELECT r.source_bucket_id,
                r.target_bucket_id,
                r.relation_type,
                r.confidence
         FROM relationships r
         WHERE (r.source_bucket_id = ANY($1::uuid[]) OR r.target_bucket_id = ANY($1::uuid[]))
           AND r.source_bucket_id IS NOT NULL
           AND r.target_bucket_id IS NOT NULL
           ${userClause}
         ORDER BY r.confidence DESC
         LIMIT $${idx}`,
        values
      );

      const seedSet = new Set(seedIds);
      const neighborMeta = new Map<
        string,
        { viaRelation: string; confidence: number }
      >();

      for (const row of rows) {
        const other = seedSet.has(row.source_bucket_id)
          ? row.target_bucket_id
          : row.source_bucket_id;

        if (!other || seedSet.has(other)) continue;

        const existing = neighborMeta.get(other);

        if (!existing || row.confidence > existing.confidence) {
          neighborMeta.set(other, {
            viaRelation: row.relation_type,
            confidence: Number(row.confidence),
          });
        }

        if (neighborMeta.size >= GRAPH_NEIGHBOR_LIMIT) break;
      }

      return Array.from(neighborMeta.entries()).map(([bucketId, meta]) => ({
        bucketId,
        viaRelation: meta.viaRelation,
        confidence: meta.confidence,
      }));
    } catch (error) {
      logger.warn("Legacy graph expansion failed", {
        error: (error as Error).message,
      });

      return [];
    }
  }

  private mergeAllResults(
    directMatches: Map<string, DirectMatch>,
    graphExpanded: GraphExpansion[]
  ): MergedCandidate[] {
    const all = new Map<string, MergedCandidate>();

    for (const [id, match] of directMatches) {
      all.set(id, {
        bucketId: id,
        vectorSimilarity: match.vectorSimilarity,
        textMatch: match.textMatch,
        graphConnectionCount: 0,
      });
    }

    for (const ge of graphExpanded) {
      const existing = all.get(ge.bucketId);

      if (existing) {
        existing.graphConnectionCount++;
      } else {
        all.set(ge.bucketId, {
          bucketId: ge.bucketId,
          vectorSimilarity: 0,
          textMatch: false,
          graphConnectionCount: 1,
        });
      }
    }

    return Array.from(all.values());
  }

  private async highImportanceCandidates(
    querySpec: QuerySpec,
    documentId: string | undefined,
    userId: string | null
  ): Promise<MergedCandidate[]> {
    if (!userId && !documentId) return [];

    try {
      const values: unknown[] = [];
      const clauses: string[] = ["importance >= 8", "strength >= 0.1"];

      if (userId) {
        values.push(userId);
        clauses.push(`user_id = $${values.length}`);
      }

      if (documentId) {
        values.push(documentId);
        clauses.push(`document_id = $${values.length}`);
      }

      values.push(HIGH_IMPORTANCE_FALLBACK_LIMIT);
      const limitParam = values.length;

      const rows = await queryMany<{ bucket_id: string }>(
        `SELECT bucket_id
         FROM buckets
         WHERE ${clauses.join(" AND ")}
         ORDER BY importance DESC, strength DESC, last_accessed DESC
         LIMIT $${limitParam}`,
        values
      );

      return rows.map((row) => ({
        bucketId: row.bucket_id,
        vectorSimilarity: 0,
        textMatch: false,
        graphConnectionCount: 0,
      }));
    } catch (error) {
      logger.warn("High importance fallback failed", {
        userId,
        documentId,
        error: (error as Error).message,
      });

      return [];
    }
  }

  private async batchGetConnectivity(
    bucketIds: string[],
    userId: string | null,
    currentDocumentId: string | undefined,
    recentBucketIds: string[],
    bucketMap: Map<string, BucketRow>
  ): Promise<Map<string, RetrievalConnectivityMeta>> {
    const result = new Map<string, RetrievalConnectivityMeta>();

    if (!userId || bucketIds.length === 0) {
      return result;
    }

    const candidateSet = new Set(bucketIds);
    const recentSet = new Set(recentBucketIds);
    const aggregates = new Map<string, ConnectivityAggregate>();
    const edgeLimit = Math.min(2000, bucketIds.length * 20 + 100);

    try {
      const rows = await queryMany<ConnectivityEdgeRow>(
        `SELECT r.source_bucket_id,
                r.target_bucket_id,
                r.confidence,
                b1.document_id AS source_document_id,
                b2.document_id AS target_document_id
         FROM relationships r
         JOIN buckets b1 ON b1.bucket_id = r.source_bucket_id
         JOIN buckets b2 ON b2.bucket_id = r.target_bucket_id
         WHERE (r.source_bucket_id = ANY($1::uuid[]) OR r.target_bucket_id = ANY($1::uuid[]))
           AND r.source_bucket_id IS NOT NULL
           AND r.target_bucket_id IS NOT NULL
           AND (r.user_id = $2 OR r.user_id IS NULL)
           AND b1.user_id = $2
           AND b2.user_id = $2
         ORDER BY r.confidence DESC
         LIMIT $3`,
        [bucketIds, userId, edgeLimit]
      );

      for (const row of rows) {
        const confidence = clampUnit(row.confidence);

        const pairs: Array<{
          candidate: string;
          other: string;
          ownDoc: string | null;
          otherDoc: string | null;
        }> = [];

        if (candidateSet.has(row.source_bucket_id)) {
          pairs.push({
            candidate: row.source_bucket_id,
            other: row.target_bucket_id,
            ownDoc: row.source_document_id,
            otherDoc: row.target_document_id,
          });
        }

        if (candidateSet.has(row.target_bucket_id)) {
          pairs.push({
            candidate: row.target_bucket_id,
            other: row.source_bucket_id,
            ownDoc: row.target_document_id,
            otherDoc: row.source_document_id,
          });
        }

        for (const pair of pairs) {
          if (!pair.other || pair.other === pair.candidate) continue;

          const agg =
            aggregates.get(pair.candidate) ??
            ({
              others: new Set<string>(),
              crossDocs: new Set<string>(),
              confidences: [],
              edgeToCurrent: false,
              edgeToRecent: false,
            } as ConnectivityAggregate);

          agg.others.add(pair.other);
          agg.confidences.push(confidence);

          const ownDoc =
            bucketMap.get(pair.candidate)?.document_id ?? pair.ownDoc ?? null;

          const otherDoc = pair.otherDoc ?? null;

          if (otherDoc && otherDoc !== ownDoc) {
            agg.crossDocs.add(pair.other);
          }

          if (
            currentDocumentId &&
            (otherDoc === currentDocumentId || ownDoc === currentDocumentId)
          ) {
            agg.edgeToCurrent = true;
          }

          if (recentSet.has(pair.other)) {
            agg.edgeToRecent = true;
          }

          aggregates.set(pair.candidate, agg);
        }
      }
    } catch (error) {
      logger.warn("Connectivity batch query failed", {
        userId,
        count: bucketIds.length,
        error: (error as Error).message,
      });
    }

    for (const bucketId of bucketIds) {
      const agg = aggregates.get(bucketId);
      const ownDoc = bucketMap.get(bucketId)?.document_id ?? null;

      const connectedToCurrentDocument = Boolean(
        currentDocumentId &&
        (ownDoc === currentDocumentId || agg?.edgeToCurrent)
      );

      const connectedToRecent =
        recentSet.has(bucketId) || Boolean(agg?.edgeToRecent);

      const degree = agg ? agg.others.size : 0;
      const crossDocumentDegree = agg ? agg.crossDocs.size : 0;

      const avgConfidence =
        agg && agg.confidences.length > 0
          ? clampUnit(
            agg.confidences.reduce((sum, value) => sum + value, 0) /
            agg.confidences.length
          )
          : 0;

      let score =
        0.45 * Math.min(1, degree / 8) +
        0.25 * Math.min(1, crossDocumentDegree / 4) +
        0.2 * avgConfidence;

      if (connectedToCurrentDocument) score += 0.1;
      if (connectedToRecent) score += 0.05;

      result.set(bucketId, {
        score: clampUnit(score),
        degree,
        crossDocumentDegree,
        avgConfidence,
        connectedToCurrentDocument,
        connectedToRecent,
      });
    }

    return result;
  }

  private fallbackConnectivity(
    candidate: RetrievalCandidate,
    documentId: string | undefined,
    recentSeedIds: string[]
  ): RetrievalConnectivityMeta {
    const connectedToCurrentDocument = Boolean(
      documentId && candidate.documentId === documentId
    );

    const connectedToRecent = recentSeedIds.includes(candidate.bucketId);

    let score = 0;

    if (connectedToCurrentDocument) score += 0.1;
    if (connectedToRecent) score += 0.05;

    return {
      score: clampUnit(score),
      degree: 0,
      crossDocumentDegree: 0,
      avgConfidence: 0,
      connectedToCurrentDocument,
      connectedToRecent,
    };
  }

  private async batchGetBuckets(
    bucketIds: string[],
    userId?: string | null
  ): Promise<BucketRow[]> {
    if (bucketIds.length === 0) return [];

    try {
      return userId
        ? await queryMany<BucketRow>(
          `SELECT bucket_id, canonical, strength, importance, concept_type,
                    last_accessed, access_count, decay_rate, document_id, user_id
             FROM buckets
             WHERE bucket_id = ANY($1::uuid[])
               AND user_id = $2`,
          [bucketIds, userId]
        )
        : await queryMany<BucketRow>(
          `SELECT bucket_id, canonical, strength, importance, concept_type,
                    last_accessed, access_count, decay_rate, document_id, user_id
             FROM buckets
             WHERE bucket_id = ANY($1::uuid[])`,
          [bucketIds]
        );
    } catch (error) {
      logger.error("Batch get buckets failed", {
        count: bucketIds.length,
        error: (error as Error).message,
      });

      return [];
    }
  }

  private async batchGetItems(bucketIds: string[]): Promise<BucketItemRow[]> {
    if (bucketIds.length === 0) return [];

    try {
      return await queryMany<BucketItemRow>(
        `SELECT bucket_id, label, definition, source
         FROM bucket_items
         WHERE bucket_id = ANY($1::uuid[])`,
        [bucketIds]
      );
    } catch (error) {
      logger.error("Batch get items failed", {
        count: bucketIds.length,
        error: (error as Error).message,
      });

      return [];
    }
  }
}

let instance: Retriever | null = null;

export function getRetriever(deps: {
  embeddingSearcher: EmbeddingSearcher;
  textSearcher: TextSearcher;
  graphSearcher: GraphSearcher;
}): Retriever {
  if (!instance) {
    instance = new Retriever(deps);
  }

  return instance;
}