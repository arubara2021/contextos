import logger from "../utils/logger";
import type { QuerySpec } from "./query-analyzer";
import type { ScoredCandidate } from "./scorer";
import type { ConceptType } from "../models/concept.model";
import {
  InjectedMemory,
  ContextAssemblyResult,
  ContextTimings,
  createInjectedMemory,
  createContextBlock,
  emptyContextBlock,
  emptyContextTimings,
} from "../models/context.model";
import { ForgettingBudget, BudgetCandidate } from "../memory/forgetting-budget";

const MAX_SOURCE_RATIO = 0.6;
const INJECTION_SEMANTIC_FLOOR = 0.12;
const INJECTION_TEXT_RESCUE_SCORE = 0.5;
const BROAD_RECALL_INTENTS = new Set(["recall", "summarize", "explore"]);

const SYSTEM_HEADER = `You are an AI assistant with access to the user's persistent memory. The following memories were retrieved from their knowledge base based on the current conversation. Use these memories to provide personalized, contextually relevant responses.

Guidelines:
- Reference memories naturally as if recalling past conversations
- If a memory is relevant, incorporate it into your response
- If multiple memories relate, synthesize them
- Do not list memories mechanically; weave them into natural conversation
- If no memories are relevant, respond normally without forcing references`;

export class Assembler {
  private readonly budget: ForgettingBudget;

  constructor(budget?: ForgettingBudget) {
    this.budget = budget ?? new ForgettingBudget();
  }

  assemble(
    scoredCandidates: ScoredCandidate[],
    queryAnalysis: QuerySpec
  ): ContextAssemblyResult {
    const start = Date.now();

    if (scoredCandidates.length === 0) {
      return this.emptyResult();
    }

    const topSemantic = scoredCandidates.reduce(
      (max, s) => Math.max(max, s.scores.semanticScore),
      0
    );

    const topText = scoredCandidates.reduce(
      (max, s) => Math.max(max, s.scores.textScore ?? 0),
      0
    );

    const isChitchat =
      queryAnalysis.intent === "chitchat" || queryAnalysis.isChitchat === true;

    const broadRecall =
      BROAD_RECALL_INTENTS.has(queryAnalysis.intent) &&
      queryAnalysis.specificity < 0.4;

    const isAbstractQuery = Boolean(queryAnalysis.isAbstractQuery);

    const documentScoped = Boolean(queryAnalysis.documentScoped);

    const hasDirectEvidence =
      topSemantic >= INJECTION_SEMANTIC_FLOOR ||
      topText >= INJECTION_TEXT_RESCUE_SCORE;

    if (
      isChitchat ||
      (!broadRecall && !isAbstractQuery && !hasDirectEvidence)
    ) {
      logger.debug("Context injection suppressed", {
        isChitchat,
        broadRecall,
        isAbstractQuery,
        documentScoped,
        intent: queryAnalysis.intent,
        topSemantic: Math.round(topSemantic * 10000) / 10000,
        topText: Math.round(topText * 10000) / 10000,
        semanticFloor: INJECTION_SEMANTIC_FLOOR,
        textRescueScore: INJECTION_TEXT_RESCUE_SCORE,
      });

      return this.emptyResult();
    }

    const retrievalMs = Date.now() - start;
    const scoringMs = Date.now() - start;
    const assemblyStart = Date.now();

    const budgetCandidates = this.toBudgetCandidates(scoredCandidates);

    const budgetSize = this.budget.computeBudget(
      queryAnalysis.specificity,
      budgetCandidates.length
    );

    const budgetResult = this.budget.enforceBudget(budgetCandidates, budgetSize);

    const diversified = this.applyDiversityConstraint(
      budgetResult.selected,
      budgetSize
    );

    const selected = this.sortByRank(diversified);

    const scoredMap = new Map<string, ScoredCandidate>();

    for (const candidate of scoredCandidates) {
      scoredMap.set(candidate.bucketId, candidate);
    }

    const selectedScored = selected
      .map((item) => scoredMap.get(item.bucketId))
      .filter((candidate): candidate is ScoredCandidate => Boolean(candidate));

    const selectedMemories: InjectedMemory[] = selectedScored.map(
      (candidate, index) =>
        createInjectedMemory({
          bucketId: candidate.bucketId,
          label: candidate.canonical,
          definition: candidate.definition ?? "",
          conceptType: candidate.conceptType as ConceptType,
          relevanceScore: candidate.scores.relevanceScore,
          strength: candidate.strength,
          source: candidate.sources[0] ?? "",
          rank: index + 1,
        })
    );

    const availableMemories: InjectedMemory[] = scoredCandidates.map(
      (candidate, index) =>
        createInjectedMemory({
          bucketId: candidate.bucketId,
          label: candidate.canonical,
          definition: candidate.definition ?? "",
          conceptType: candidate.conceptType as ConceptType,
          relevanceScore: candidate.scores.relevanceScore,
          strength: candidate.strength,
          source: candidate.sources[0] ?? "",
          rank: candidate.rank || index + 1,
        })
    );

    const currentDocumentId = queryAnalysis.currentDocumentId ?? null;

    const enrichedSelectedMemories = selectedScored.map((candidate, index) => {
      const base = selectedMemories[index];

      return {
        ...base,
        documentId: candidate.documentId ?? null,
        documentFilename: candidate.sources[0] ?? null,
        connectionConfidence: candidate.scores.connectivityScore ?? 0,
        connectedToCurrentDocument: Boolean(
          currentDocumentId && candidate.documentId === currentDocumentId
        ),
        connectedMemories: [],
      };
    }) as InjectedMemory[];

    const rawText = this.formatContextBlock(enrichedSelectedMemories);

    const contextBlock = createContextBlock({
      rawText,
      memories: enrichedSelectedMemories,
      totalCandidates: scoredCandidates.length,
      budgetUsed: enrichedSelectedMemories.length,
      budgetMax: budgetSize,
    });

    const assemblyMs = Date.now() - assemblyStart;

    const timings: ContextTimings = {
      retrievalMs,
      scoringMs,
      assemblyMs,
      totalMs: Date.now() - start,
    };

    logger.debug("Context assembly complete", {
      totalCandidates: scoredCandidates.length,
      budgetMax: budgetSize,
      selected: enrichedSelectedMemories.length,
      topSemantic: Math.round(topSemantic * 10000) / 10000,
      assemblyMs,
    });

    return {
      contextBlock,
      selectedMemories: enrichedSelectedMemories,
      availableMemories,
      timings,
    } as ContextAssemblyResult;
  }

  private emptyResult(): ContextAssemblyResult {
    return {
      contextBlock: emptyContextBlock(),
      selectedMemories: [],
      availableMemories: [],
      timings: emptyContextTimings(),
    } as ContextAssemblyResult;
  }

  private toBudgetCandidates(scored: ScoredCandidate[]): BudgetCandidate[] {
    return scored.map(
      (s) =>
      ({
        bucketId: s.bucketId,
        label: s.canonical,
        definition: s.definition ?? "",
        conceptType: s.conceptType,
        relevanceScore: s.scores.relevanceScore,
        strength: s.strength,
        source: s.sources[0] ?? "",
        importance: s.importance,
        rank: s.rank,
      } as BudgetCandidate)
    );
  }

  private applyDiversityConstraint(
    items: BudgetCandidate[],
    budgetSize: number
  ): BudgetCandidate[] {
    if (items.length <= 2) return items;

    const maxFromOneSource = Math.max(
      1,
      Math.floor(budgetSize * MAX_SOURCE_RATIO)
    );

    const sourceCount = new Map<string, number>();
    const selected: BudgetCandidate[] = [];
    const deferred: BudgetCandidate[] = [];

    for (const item of items) {
      const source = item.source || "unknown";
      const count = sourceCount.get(source) ?? 0;

      if (count < maxFromOneSource) {
        selected.push(item);
        sourceCount.set(source, count + 1);
      } else {
        deferred.push(item);
      }
    }

    const remainingSlots = budgetSize - selected.length;

    if (remainingSlots > 0 && deferred.length > 0) {
      for (let i = 0; i < Math.min(remainingSlots, deferred.length); i++) {
        selected.push(deferred[i]);
      }
    }

    return selected.slice(0, budgetSize);
  }

  private sortByRank(items: BudgetCandidate[]): BudgetCandidate[] {
    return [...items].sort((a, b) => {
      const rankA = Number((a as any).rank ?? 999);
      const rankB = Number((b as any).rank ?? 999);

      if (rankA !== rankB) {
        return rankA - rankB;
      }

      return b.relevanceScore - a.relevanceScore;
    });
  }

  private formatContextBlock(memories: any[]): string {
    if (memories.length === 0) return "";

    const lines: string[] = [
      "=== RETRIEVED MEMORIES FROM THE USER'S KNOWLEDGE BASE ===",
      "",
    ];

    for (const memory of memories) {
      const typeLabel = String(memory.conceptType ?? "fact").toUpperCase();
      const strengthPct = Math.round(Number(memory.strength ?? 0) * 100);

      let line = `(${memory.rank}) [${typeLabel}] ${memory.label}: ${memory.definition} [strength: ${strengthPct}%]`;

      const sourceName = memory.documentFilename ?? memory.source;

      if (sourceName) {
        line += ` [source: ${sourceName}]`;
      }

      if (Number(memory.connectionConfidence ?? 0) > 0) {
        line += ` [connection: ${Number(memory.connectionConfidence).toFixed(2)}]`;
      }

      if (memory.connectedToCurrentDocument) {
        line += ` [linked to current document]`;
      }

      if (Array.isArray(memory.connectedMemories) && memory.connectedMemories.length > 0) {
        line += ` [connected: ${memory.connectedMemories.slice(0, 3).join(", ")}]`;
      }

      lines.push(line);
    }

    lines.push("");
    lines.push("=== END OF CANDIDATE MEMORIES ===");

    return lines.join("\n");
  }
}

let assemblerInstance: Assembler | null = null;

export function getAssembler(): Assembler {
  if (!assemblerInstance) {
    assemblerInstance = new Assembler();
  }

  return assemblerInstance;
}