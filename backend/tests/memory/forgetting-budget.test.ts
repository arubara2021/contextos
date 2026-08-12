import { ForgettingBudget } from "../../src/memory/forgetting-budget";
import config from "../../src/config";

describe("ForgettingBudget", () => {
  let budget: ForgettingBudget;

  beforeEach(() => {
    budget = new ForgettingBudget(10);
  });

  describe("computeBudget", () => {
    it("returns 0 when no candidates", () => {
      expect(budget.computeBudget(0.5, 0)).toBe(0);
    });

    it("returns full budget for low specificity", () => {
      const result = budget.computeBudget(0.3, 20);
      expect(result).toBe(10);
    });

    it("returns reduced budget for medium specificity", () => {
      const result = budget.computeBudget(0.6, 20);
      expect(result).toBe(8);
    });

    it("returns further reduced budget for high specificity", () => {
      const result = budget.computeBudget(0.9, 20);
      expect(result).toBe(6);
    });

    it("caps budget at numCandidates", () => {
      const result = budget.computeBudget(0.3, 5);
      expect(result).toBe(5);
    });

    it("returns at least 1 when candidates exist", () => {
      const smallBudget = new ForgettingBudget(1);
      const result = smallBudget.computeBudget(0.9, 100);
      expect(result).toBeGreaterThanOrEqual(1);
    });
  });

  describe("enforceBudget", () => {
    function createCandidate(overrides?: Record<string, unknown>) {
      return {
        bucketId: "b1",
        label: "Test",
        definition: "A test",
        conceptType: "fact",
        relevanceScore: 0.8,
        strength: 0.5,
        source: "test",
        importance: 5,
        rank: 1,
        ...overrides,
      };
    }

    it("selects top candidates by relevance score", () => {
      const candidates = [
        createCandidate({ bucketId: "b1", relevanceScore: 0.9 }),
        createCandidate({ bucketId: "b2", relevanceScore: 0.5 }),
        createCandidate({ bucketId: "b3", relevanceScore: 0.7 }),
      ];

      const result = budget.enforceBudget(candidates, 2);

      expect(result.selected).toHaveLength(2);
      expect(result.remaining).toHaveLength(1);
      expect(result.budgetUsed).toBe(2);
    });

    it("returns empty when budget is 0", () => {
      const candidates = [createCandidate()];

      const result = budget.enforceBudget(candidates, 0);

      expect(result.selected).toHaveLength(0);
      expect(result.remaining).toHaveLength(1);
    });

    it("returns empty for empty candidates", () => {
      const result = budget.enforceBudget([], 5);

      expect(result.selected).toHaveLength(0);
      expect(result.remaining).toHaveLength(0);
    });

    it("limits same-source ratio", () => {
      const candidates = [
        createCandidate({ bucketId: "b1", relevanceScore: 0.9, source: "same" }),
        createCandidate({ bucketId: "b2", relevanceScore: 0.85, source: "same" }),
        createCandidate({ bucketId: "b3", relevanceScore: 0.8, source: "same" }),
        createCandidate({ bucketId: "b4", relevanceScore: 0.7, source: "same" }),
        createCandidate({ bucketId: "b5", relevanceScore: 0.6, source: "other" }),
        createCandidate({ bucketId: "b6", relevanceScore: 0.55, source: "other" }),
      ];

      const result = budget.enforceBudget(candidates, 6);

      const sameSourceCount = result.selected.filter((c) => c.source === "same").length;
      expect(sameSourceCount).toBeLessThanOrEqual(Math.ceil(6 * 0.6));
    });

    it("includes budgetMax in result", () => {
      const result = budget.enforceBudget([createCandidate()], 5);

      expect(result.budgetMax).toBe(5);
    });
  });
});
