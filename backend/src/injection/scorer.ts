import config from "../config";
import logger from "../utils/logger";

export interface ScoredCandidate {
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
  connectivity?: {
    score: number;
    degree: number;
    crossDocumentDegree: number;
    avgConfidence: number;
    connectedToCurrentDocument: boolean;
    connectedToRecent: boolean;
  };
  scores: {
    vectorScore: number;
    textScore: number;
    graphScore: number;
    semanticScore: number;
    relevanceScore: number;
    connectivityScore: number;
  };
  relevanceScore: number;
  rank: number;
}

interface QuerySpec {
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

interface RetrievalCandidate {
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
  connectivity?: {
    score: number;
    degree: number;
    crossDocumentDegree: number;
    avgConfidence: number;
    connectedToCurrentDocument: boolean;
    connectedToRecent: boolean;
  };
  scores: {
    vectorScore: number;
    textScore: number;
    graphScore: number;
  };
}

interface ScoringDebug {
  inputCandidates: number;
  afterThresholdFilter: number;
  outputScored: number;
  isBroadQuery: boolean;
  isAbstractQuery: boolean;
  isResultsQuery: boolean;
  isMainQuery: boolean;
  isProblemQuery: boolean;
  documentScoped: boolean;
  connectivityWeight: number;
  topRawScore: number;
  topRelevanceScore: number;
  topSemanticScore: number;
  topConnectivityScore: number;
  topImportanceBoost: number;
  topSignificanceBoost: number;
  topOverviewBoost: number;
  topDocumentAffinityBoost: number;
  topTargetBoost: number;
  topGenericPenalty: number;
  scoringMs: number;
  normalizationMs: number;
  tieBreakingMs: number;
  totalMs: number;
}

const OVERVIEW_LABEL_TERMS = [
  "overview",
  "summary",
  "introduction",
  "abstract",
  "preface",
];

const RESULTS_QUERY_PATTERN =
  /(result|results|metric|metrics|performance|benchmark|evaluation|outcome|outcomes|findings|throughput|latency|accuracy|speedup|improvement|baseline|comparison|experiment|table)/i;

const MAIN_QUERY_PATTERN =
  /(main contribution|contribution|contributions|main idea|main point|main topic|what is this|what does this|about|purpose|thesis|novel|proposes|introduces|presents|core idea|primary)/i;

const PROBLEM_QUERY_PATTERN =
  /(problem|issue|challenge|gap|limitation|solve|solves|address|addresses|bottleneck|inefficiency|overhead)/i;

const GENERIC_LABELS = new Set([
  "introduction",
  "conclusion",
  "summary",
  "overview",
  "background",
  "related work",
  "methodology",
  "discussion",
  "references",
  "acknowledgments",
]);

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

export class Scorer {
  private readonly semanticWeight: number;
  private readonly strengthWeight: number;
  private readonly recencyWeight: number;
  private readonly recencyDecayFactor: number;
  private readonly tieBreakThreshold: number;
  private readonly connectivityWeight: number;

  constructor() {
    this.semanticWeight = config.scorer.semanticWeight;
    this.strengthWeight = config.scorer.strengthWeight;
    this.recencyWeight = config.scorer.recencyWeight;
    this.recencyDecayFactor = config.scorer.recencyDecayFactor;
    this.tieBreakThreshold = config.scorer.tieBreakThreshold;
    this.connectivityWeight = config.scorer.connectivityWeight;
  }

  score(
    candidates: RetrievalCandidate[],
    querySpec: QuerySpec
  ): { scored: ScoredCandidate[]; debug: ScoringDebug } {
    const totalStart = Date.now();
    const scoringStart = Date.now();

    if (candidates.length === 0) {
      return {
        scored: [],
        debug: this.emptyDebug(querySpec, Date.now() - totalStart),
      };
    }

    const isAbstractQuery = Boolean(querySpec.isAbstractQuery);
    const isResultsQuery = RESULTS_QUERY_PATTERN.test(
      querySpec.keyTerms.join(" ")
    );
    const isMainQuery = MAIN_QUERY_PATTERN.test(
      querySpec.keyTerms.join(" ")
    );
    const isProblemQuery = PROBLEM_QUERY_PATTERN.test(
      querySpec.keyTerms.join(" ")
    );
    const isBroadQuery = querySpec.specificity < 0.3;
    const documentScoped = Boolean(querySpec.documentScoped);
    const currentDocumentId = querySpec.currentDocumentId ?? null;
    const recentBucketIds = new Set(querySpec.recentBucketIds ?? []);

    const rawScores: Array<{
      candidate: RetrievalCandidate;
      rawScore: number;
      semanticScore: number;
      connectivityScore: number;
      importanceBoost: number;
      significanceBoost: number;
      overviewBoost: number;
      documentAffinityBoost: number;
      targetBoost: number;
      genericPenalty: number;
    }> = [];

    for (const candidate of candidates) {
      const semanticScore = this.computeSemanticScore(candidate, querySpec);
      const strengthScore = clampUnit(candidate.strength);
      const recencyScore = this.computeRecencyScore(candidate);
      const connectivityScore = this.computeConnectivityScore(
        candidate,
        currentDocumentId,
        recentBucketIds
      );

      let rawScore =
        semanticScore * this.semanticWeight +
        strengthScore * this.strengthWeight +
        recencyScore * this.recencyWeight +
        connectivityScore * this.connectivityWeight;

      const importanceBoost = this.computeImportanceBoost(
        candidate,
        isAbstractQuery,
        isMainQuery,
        isResultsQuery,
        isProblemQuery
      );
      const significanceBoost = this.computeSignificanceBoost(candidate);
      const overviewBoost = this.computeOverviewBoost(
        candidate,
        isAbstractQuery,
        isMainQuery
      );
      const documentAffinityBoost = this.computeDocumentAffinityBoost(
        candidate,
        currentDocumentId,
        documentScoped
      );
      const targetBoost = this.computeTargetBoost(candidate, querySpec);
      const genericPenalty = this.computeGenericPenalty(candidate);

      rawScore +=
        importanceBoost +
        significanceBoost +
        overviewBoost +
        documentAffinityBoost +
        targetBoost -
        genericPenalty;

      rawScores.push({
        candidate,
        rawScore,
        semanticScore,
        connectivityScore,
        importanceBoost,
        significanceBoost,
        overviewBoost,
        documentAffinityBoost,
        targetBoost,
        genericPenalty,
      });
    }

    const scoringMs = Date.now() - scoringStart;
    const normalizationStart = Date.now();

    const sorted = rawScores.sort((a, b) => b.rawScore - a.rawScore);

    const maxRaw = sorted.length > 0 ? sorted[0].rawScore : 0;
    const minRaw = sorted.length > 0 ? sorted[sorted.length - 1].rawScore : 0;
    const range = maxRaw - minRaw;

    let normalizedScores: number[];
    if (range < 0.001) {
      normalizedScores = sorted.map(() => 1.0 / sorted.length);
    } else {
      const expScores = sorted.map((r) =>
        Math.exp((r.rawScore - maxRaw) / Math.max(range, 0.1))
      );
      const expSum = expScores.reduce((sum, val) => sum + val, 0);
      normalizedScores = expScores.map((val) =>
        expSum > 0 ? val / expSum : 1.0 / sorted.length
      );
    }

    const normalizationMs = Date.now() - normalizationStart;
    const tieBreakingStart = Date.now();

    const scored: ScoredCandidate[] = sorted.map((entry, index) => ({
      bucketId: entry.candidate.bucketId,
      canonical: entry.candidate.canonical,
      definition: entry.candidate.definition,
      significance: entry.candidate.significance,
      conceptType: entry.candidate.conceptType,
      importance: entry.candidate.importance,
      strength: entry.candidate.strength,
      lastAccessed: entry.candidate.lastAccessed,
      accessCount: entry.candidate.accessCount,
      decayRate: entry.candidate.decayRate,
      sources: entry.candidate.sources,
      documentId: entry.candidate.documentId,
      connectivity: entry.candidate.connectivity,
      scores: {
        vectorScore: clampUnit(entry.candidate.scores.vectorScore),
        textScore: clampUnit(entry.candidate.scores.textScore),
        graphScore: clampUnit(entry.candidate.scores.graphScore),
        semanticScore: round4(entry.semanticScore),
        relevanceScore: round4(normalizedScores[index]),
        connectivityScore: round4(entry.connectivityScore),
      },
      relevanceScore: round4(normalizedScores[index]),
      rank: index + 1,
    }));

    const tieBreakingMs = Date.now() - tieBreakingStart;
    const totalMs = Date.now() - totalStart;

    const topEntry = sorted.length > 0 ? sorted[0] : null;
    const topScored = scored.length > 0 ? scored[0] : null;

    const debug: ScoringDebug = {
      inputCandidates: candidates.length,
      afterThresholdFilter: sorted.length,
      outputScored: scored.length,
      isBroadQuery,
      isAbstractQuery,
      isResultsQuery,
      isMainQuery,
      isProblemQuery,
      documentScoped,
      connectivityWeight: this.connectivityWeight,
      topRawScore: topEntry ? round4(topEntry.rawScore) : 0,
      topRelevanceScore: topScored ? round4(topScored.relevanceScore) : 0,
      topSemanticScore: topEntry ? round4(topEntry.semanticScore) : 0,
      topConnectivityScore: topEntry
        ? round4(topEntry.connectivityScore)
        : 0,
      topImportanceBoost: topEntry ? round4(topEntry.importanceBoost) : 0,
      topSignificanceBoost: topEntry
        ? round4(topEntry.significanceBoost)
        : 0,
      topOverviewBoost: topEntry ? round4(topEntry.overviewBoost) : 0,
      topDocumentAffinityBoost: topEntry
        ? round4(topEntry.documentAffinityBoost)
        : 0,
      topTargetBoost: topEntry ? round4(topEntry.targetBoost) : 0,
      topGenericPenalty: topEntry ? round4(topEntry.genericPenalty) : 0,
      scoringMs,
      normalizationMs,
      tieBreakingMs,
      totalMs,
    };

    logger.debug("Scoring complete", debug);

    return { scored, debug };
  }

  private computeSemanticScore(
    candidate: RetrievalCandidate,
    querySpec: QuerySpec
  ): number {
    const vectorScore = clampUnit(candidate.scores.vectorScore);
    const textScore = clampUnit(candidate.scores.textScore);
    const graphScore = clampUnit(candidate.scores.graphScore);

    let semantic = vectorScore * 0.5 + textScore * 0.3 + graphScore * 0.2;

    if (querySpec.preferredTypes.length > 0) {
      if (querySpec.preferredTypes.includes(candidate.conceptType)) {
        semantic *= 1.15;
      }
    }

    return clampUnit(semantic);
  }

  private computeRecencyScore(candidate: RetrievalCandidate): number {
    if (!candidate.lastAccessed) return 0.3;
    const hoursSince =
      (Date.now() - candidate.lastAccessed.getTime()) / (1000 * 60 * 60);
    return Math.exp(-this.recencyDecayFactor * hoursSince);
  }

  private computeConnectivityScore(
    candidate: RetrievalCandidate,
    currentDocumentId: string | null,
    recentBucketIds: Set<string>
  ): number {
    if (!candidate.connectivity) return 0;
    let score = clampUnit(candidate.connectivity.score);
    if (
      currentDocumentId &&
      candidate.connectivity.connectedToCurrentDocument
    ) {
      score = Math.min(1, score + 0.1);
    }
    if (recentBucketIds.has(candidate.bucketId)) {
      score = Math.min(1, score + 0.05);
    }
    return clampUnit(score);
  }

  private computeImportanceBoost(
    candidate: RetrievalCandidate,
    isAbstractQuery: boolean,
    isMainQuery: boolean,
    isResultsQuery: boolean,
    isProblemQuery: boolean
  ): number {
    const importance = candidate.importance ?? 5;

    if (isAbstractQuery || isMainQuery) {
      if (importance >= 9) return 0.35;
      if (importance >= 8) return 0.25;
      if (importance >= 7) return 0.15;
    }

    if (isResultsQuery && candidate.conceptType === "fact") {
      if (importance >= 8) return 0.2;
    }

    if (isProblemQuery && candidate.conceptType === "problem") {
      if (importance >= 8) return 0.2;
    }

    if (importance >= 9) return 0.1;
    return 0;
  }

  private computeSignificanceBoost(candidate: RetrievalCandidate): number {
    if (!candidate.significance || candidate.significance.length === 0) {
      return 0;
    }
    if (candidate.significance.length > 100) return 0.05;
    if (candidate.significance.length > 50) return 0.03;
    return 0.01;
  }

  private computeOverviewBoost(
    candidate: RetrievalCandidate,
    isAbstractQuery: boolean,
    isMainQuery: boolean
  ): number {
    if (!isAbstractQuery && !isMainQuery) return 0;

    const labelLower = (candidate.canonical || "").toLowerCase();
    const isOverviewLabel = OVERVIEW_LABEL_TERMS.some((term) =>
      labelLower.includes(term)
    );

    if (isOverviewLabel && candidate.importance >= 8) {
      return 0.3;
    }
    if (isOverviewLabel) {
      return 0.15;
    }
    return 0;
  }

  private computeDocumentAffinityBoost(
    candidate: RetrievalCandidate,
    currentDocumentId: string | null,
    documentScoped: boolean
  ): number {
    if (!documentScoped || !currentDocumentId) return 0;
    if (candidate.documentId === currentDocumentId) return 0.1;
    return 0;
  }

  private computeTargetBoost(
    candidate: RetrievalCandidate,
    querySpec: QuerySpec
  ): number {
    const allTerms = [
      ...querySpec.keyTerms,
      ...(querySpec.expandedTerms || []),
    ];
    const labelLower = (candidate.canonical || "").toLowerCase();
    const definitionLower = (candidate.definition || "").toLowerCase();

    let matchCount = 0;
    for (const term of allTerms) {
      const termLower = term.toLowerCase();
      if (labelLower.includes(termLower)) matchCount += 2;
      else if (definitionLower.includes(termLower)) matchCount += 1;
    }

    if (matchCount >= 6) return 0.15;
    if (matchCount >= 4) return 0.1;
    if (matchCount >= 2) return 0.05;
    return 0;
  }

  private computeGenericPenalty(candidate: RetrievalCandidate): number {
    const labelLower = (candidate.canonical || "").toLowerCase();
    if (GENERIC_LABELS.has(labelLower)) {
      return 0.05;
    }
    if (
      candidate.conceptType === "fact" &&
      candidate.importance <= 3 &&
      (candidate.definition || "").length < 30
    ) {
      return 0.03;
    }
    return 0;
  }

  private emptyDebug(querySpec: QuerySpec, totalMs: number): ScoringDebug {
    return {
      inputCandidates: 0,
      afterThresholdFilter: 0,
      outputScored: 0,
      isBroadQuery: querySpec.specificity < 0.3,
      isAbstractQuery: Boolean(querySpec.isAbstractQuery),
      isResultsQuery: false,
      isMainQuery: false,
      isProblemQuery: false,
      documentScoped: Boolean(querySpec.documentScoped),
      connectivityWeight: this.connectivityWeight,
      topRawScore: 0,
      topRelevanceScore: 0,
      topSemanticScore: 0,
      topConnectivityScore: 0,
      topImportanceBoost: 0,
      topSignificanceBoost: 0,
      topOverviewBoost: 0,
      topDocumentAffinityBoost: 0,
      topTargetBoost: 0,
      topGenericPenalty: 0,
      scoringMs: 0,
      normalizationMs: 0,
      tieBreakingMs: 0,
      totalMs,
    };
  }
}

let scorerInstance: Scorer | null = null;

export function getScorer(): Scorer {
  if (!scorerInstance) {
    scorerInstance = new Scorer();
  }
  return scorerInstance;
}