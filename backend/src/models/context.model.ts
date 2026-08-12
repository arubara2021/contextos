import type { ConceptType } from "./concept.model";

export interface InjectedMemory {
  bucketId: string;
  label: string;
  definition: string;
  conceptType: ConceptType;
  relevanceScore: number;
  strength: number;
  source: string;
  rank: number;
}

export interface ContextBlock {
  rawText: string;
  memories: InjectedMemory[];
  totalCandidates: number;
  budgetUsed: number;
  budgetMax: number;
}

export interface ContextAssemblyResult {
  contextBlock: ContextBlock;
  selectedMemories: InjectedMemory[];
  availableMemories: InjectedMemory[];
  timings: ContextTimings;
}

export interface ContextTimings {
  retrievalMs: number;
  scoringMs: number;
  assemblyMs: number;
  totalMs: number;
}

export function createInjectedMemory(params: {
  bucketId: string;
  label: string;
  definition: string;
  conceptType: ConceptType;
  relevanceScore: number;
  strength: number;
  source: string;
  rank: number;
}): InjectedMemory {
  return {
    bucketId: params.bucketId,
    label: params.label,
    definition: params.definition,
    conceptType: params.conceptType,
    relevanceScore: roundScore(params.relevanceScore),
    strength: roundScore(params.strength),
    source: params.source,
    rank: params.rank,
  };
}

export function createContextBlock(params: {
  rawText: string;
  memories: InjectedMemory[];
  totalCandidates: number;
  budgetUsed: number;
  budgetMax: number;
}): ContextBlock {
  return {
    rawText: params.rawText,
    memories: params.memories,
    totalCandidates: params.totalCandidates,
    budgetUsed: params.budgetUsed,
    budgetMax: params.budgetMax,
  };
}

export function emptyContextBlock(): ContextBlock {
  return {
    rawText: "",
    memories: [],
    totalCandidates: 0,
    budgetUsed: 0,
    budgetMax: 0,
  };
}

export function emptyContextTimings(): ContextTimings {
  return {
    retrievalMs: 0,
    scoringMs: 0,
    assemblyMs: 0,
    totalMs: 0,
  };
}

export function createAssemblyResult(
  contextBlock: ContextBlock,
  allScored: InjectedMemory[],
  timings: ContextTimings
): ContextAssemblyResult {
  const injectedIds = new Set(contextBlock.memories.map((m) => m.bucketId));
  const available = allScored.filter((m) => !injectedIds.has(m.bucketId));
  return {
    contextBlock,
    selectedMemories: contextBlock.memories,
    availableMemories: available,
    timings,
  };
}

function roundScore(value: number): number {
  return Math.round(value * 10000) / 10000;
}