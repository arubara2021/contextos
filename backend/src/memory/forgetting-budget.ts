import config from "../config";

export interface BudgetCandidate {
  bucketId: string;
  label: string;
  definition: string;
  conceptType: string;
  relevanceScore: number;
  strength: number;
  source: string;
  importance: number;
  rank: number;
}

export interface BudgetResult {
  selected: BudgetCandidate[];
  remaining: BudgetCandidate[];
  budgetUsed: number;
  budgetMax: number;
}

const MIN_SELECT_RELEVANCE = 0.015;

export class ForgettingBudget {
  private readonly maxBudget: number;
  private readonly maxSameSourceRatio: number;
  private readonly minTypeDiversity: number;

  constructor(
    maxBudget?: number,
    maxSameSourceRatio: number = 0.6,
    minTypeDiversity: number = 2
  ) {
    this.maxBudget = maxBudget ?? config.memory.maxContextMemories;
    this.maxSameSourceRatio = maxSameSourceRatio;
    this.minTypeDiversity = minTypeDiversity;
  }

  computeBudget(querySpecificity: number, numCandidates: number): number {
    if (numCandidates === 0) return 0;
    const baseBudget = this.maxBudget;
    let adjustedBudget: number;
    if (querySpecificity > 0.8) {
      adjustedBudget = Math.ceil(baseBudget * 0.6);
    } else if (querySpecificity > 0.5) {
      adjustedBudget = Math.ceil(baseBudget * 0.8);
    } else {
      adjustedBudget = baseBudget;
    }
    adjustedBudget = Math.max(1, Math.min(adjustedBudget, numCandidates));
    return adjustedBudget;
  }

  enforceBudget(
    scoredCandidates: BudgetCandidate[],
    budget: number
  ): BudgetResult {
    if (budget <= 0 || scoredCandidates.length === 0) {
      return {
        selected: [],
        remaining: [...scoredCandidates],
        budgetUsed: 0,
        budgetMax: budget,
      };
    }

    const sorted = [...scoredCandidates].sort(
      (a, b) => b.relevanceScore - a.relevanceScore
    );

    const selected: BudgetCandidate[] = [];
    const remaining: BudgetCandidate[] = [];
    const sourceCount = new Map<string, number>();
    const typeSet = new Set<string>();

    for (const candidate of sorted) {
      if (selected.length >= budget) {
        remaining.push(candidate);
        continue;
      }
      if (candidate.relevanceScore < MIN_SELECT_RELEVANCE) {
        remaining.push(candidate);
        continue;
      }
      const source = candidate.source || "unknown";
      const currentSourceCount = sourceCount.get(source) ?? 0;
      const maxFromSource = Math.ceil(budget * this.maxSameSourceRatio);
      if (currentSourceCount >= maxFromSource && selected.length > this.minTypeDiversity) {
        remaining.push(candidate);
        continue;
      }
      selected.push(candidate);
      sourceCount.set(source, currentSourceCount + 1);
      typeSet.add(candidate.conceptType);
    }

    const diversified = this.ensureTypeDiversity(selected, remaining, budget);
    return {
      selected: diversified.selected,
      remaining: diversified.remaining,
      budgetUsed: diversified.selected.length,
      budgetMax: budget,
    };
  }

  private ensureTypeDiversity(
    selected: BudgetCandidate[],
    remaining: BudgetCandidate[],
    budget: number
  ): { selected: BudgetCandidate[]; remaining: BudgetCandidate[] } {
    const typeCount = new Map<string, number>();
    for (const item of selected) {
      typeCount.set(item.conceptType, (typeCount.get(item.conceptType) ?? 0) + 1);
    }
    const uniqueTypes = typeCount.size;
    if (uniqueTypes >= this.minTypeDiversity || selected.length < 2) {
      return { selected, remaining };
    }
    const dominatedType = this.findDominatedType(typeCount, selected.length);
    if (!dominatedType) {
      return { selected, remaining };
    }
    const dominatedItems = selected.filter((s) => s.conceptType === dominatedType);
    if (dominatedItems.length <= 1) {
      return { selected, remaining };
    }
    const swapCandidate = dominatedItems[dominatedItems.length - 1];
    const replacement = remaining.find((r) => r.conceptType !== dominatedType);
    if (!replacement) {
      return { selected, remaining };
    }
    const newSelected = selected.filter((s) => s !== swapCandidate);
    newSelected.push(replacement);
    newSelected.sort((a, b) => b.relevanceScore - a.relevanceScore);
    const newRemaining = remaining.filter((r) => r !== replacement);
    newRemaining.push(swapCandidate);
    return { selected: newSelected, remaining: newRemaining };
  }

  private findDominatedType(
    typeCount: Map<string, number>,
    totalSelected: number
  ): string | null {
    let dominatedType: string | null = null;
    let maxRatio = 0;
    for (const [type, count] of typeCount) {
      const ratio = count / totalSelected;
      if (ratio > maxRatio && ratio > 0.7) {
        maxRatio = ratio;
        dominatedType = type;
      }
    }
    return dominatedType;
  }
}

let forgettingBudgetInstance: ForgettingBudget | null = null;

export function getForgettingBudget(): ForgettingBudget {
  if (!forgettingBudgetInstance) {
    forgettingBudgetInstance = new ForgettingBudget();
  }
  return forgettingBudgetInstance;
}