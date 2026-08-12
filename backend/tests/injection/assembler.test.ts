import { Assembler } from "../../src/injection/assembler";
import type { ScoredCandidate } from "../../src/injection/scorer";
import type { QueryAnalysis } from "../../src/injection/query-analyzer";

function createScoredCandidate(overrides?: Partial<ScoredCandidate>): ScoredCandidate {
  return {
    bucketId: "bucket-1",
    label: "TypeScript",
    definition: "A typed superset of JavaScript",
    conceptType: "fact",
    strength: 0.7,
    importance: 7,
    source: "chat:session-1",
    lastAccessed: new Date("2024-06-01"),
    accessCount: 5,
    decayRate: 0.15,
    scores: {
      semanticScore: 0.8,
      strengthScore: 0.7,
      recencyScore: 0.6,
      relevanceScore: 0.85,
      vectorScore: 0.9,
      textScore: 0.7,
      graphScore: 0.5,
    },
    rank: 1,
    ...overrides,
  };
}

function createQueryAnalysis(overrides?: Partial<QueryAnalysis>): QueryAnalysis {
  return {
    keyTerms: ["typescript", "configuration"],
    intent: "recall",
    specificity: 0.5,
    ...overrides,
  };
}

describe("Assembler", () => {
  let assembler: Assembler;

  beforeEach(() => {
    assembler = new Assembler();
  });

  describe("assemble", () => {
    it("returns empty context block for empty candidates", () => {
      const result = assembler.assemble([], createQueryAnalysis());

      expect(result.contextBlock.rawText).toBe("");
      expect(result.contextBlock.memories).toEqual([]);
      expect(result.contextBlock.totalCandidates).toBe(0);
      expect(result.contextBlock.budgetUsed).toBe(0);
    });

    it("selects top candidates within budget", () => {
      const candidates = Array.from({ length: 20 }, (_, i) =>
        createScoredCandidate({
          bucketId: `b${i}`,
          scores: { ...createScoredCandidate().scores, relevanceScore: 1 - i * 0.01 },
        })
      );

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.memories.length).toBeGreaterThan(0);
      expect(result.contextBlock.memories.length).toBeLessThanOrEqual(20);
    });

    it("includes all candidates when budget exceeds count", () => {
      const candidates = [
        createScoredCandidate({ bucketId: "b1" }),
        createScoredCandidate({ bucketId: "b2" }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.memories.length).toBe(2);
      expect(result.contextBlock.totalCandidates).toBe(2);
    });

    it("tracks total candidates", () => {
      const candidates = Array.from({ length: 50 }, (_, i) =>
        createScoredCandidate({ bucketId: `b${i}` })
      );

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.totalCandidates).toBe(50);
    });

    it("assigns sequential ranks to selected memories", () => {
      const candidates = [
        createScoredCandidate({ bucketId: "b1", scores: { ...createScoredCandidate().scores, relevanceScore: 0.9 } }),
        createScoredCandidate({ bucketId: "b2", scores: { ...createScoredCandidate().scores, relevanceScore: 0.8 } }),
        createScoredCandidate({ bucketId: "b3", scores: { ...createScoredCandidate().scores, relevanceScore: 0.7 } }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      result.contextBlock.memories.forEach((mem, idx) => {
        expect(mem.rank).toBe(idx + 1);
      });
    });

    it("builds raw text with memory entries", () => {
      const candidates = [
        createScoredCandidate({
          label: "TypeScript",
          definition: "A typed superset of JavaScript",
          conceptType: "fact",
          strength: 0.8,
        }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toContain("TypeScript");
      expect(result.contextBlock.rawText).toContain("A typed superset of JavaScript");
      expect(result.contextBlock.rawText).toContain("FACT");
    });

    it("includes strength percentage in raw text", () => {
      const candidates = [createScoredCandidate({ strength: 0.75 })];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toContain("75%");
    });

    it("includes source when available", () => {
      const candidates = [createScoredCandidate({ source: "chat:session-abc" })];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toContain("chat:session-abc");
    });

    it("returns timing information", () => {
      const result = assembler.assemble([createScoredCandidate()], createQueryAnalysis());

      expect(result.timings).toBeDefined();
      expect(result.timings.assemblyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("budget behavior", () => {
    it("reduces budget for high-specificity queries", () => {
      const candidates = Array.from({ length: 20 }, (_, i) =>
        createScoredCandidate({ bucketId: `b${i}` })
      );

      const specificResult = assembler.assemble(candidates, createQueryAnalysis({ specificity: 0.95 }));
      const broadResult = assembler.assemble(candidates, createQueryAnalysis({ specificity: 0.1 }));

      expect(specificResult.contextBlock.budgetUsed).toBeLessThanOrEqual(
        broadResult.contextBlock.budgetUsed
      );
    });

    it("never selects more than available", () => {
      const candidates = [createScoredCandidate()];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.budgetUsed).toBeLessThanOrEqual(1);
    });
  });

  describe("raw text formatting", () => {
    it("includes system header", () => {
      const candidates = [createScoredCandidate()];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toContain("Retrieved memories");
    });

    it("numbers memories sequentially", () => {
      const candidates = [
        createScoredCandidate({ bucketId: "b1" }),
        createScoredCandidate({ bucketId: "b2" }),
        createScoredCandidate({ bucketId: "b3" }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());
      const text = result.contextBlock.rawText;

      expect(text).toContain("1.");
      expect(text).toContain("2.");
      expect(text).toContain("3.");
    });

    it("includes type labels in brackets", () => {
      const candidates = [createScoredCandidate({ conceptType: "decision" })];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toContain("[DECISION]");
    });

    it("returns empty string for no candidates", () => {
      const result = assembler.assemble([], createQueryAnalysis());

      expect(result.contextBlock.rawText).toBe("");
    });
  });

  describe("edge cases", () => {
    it("handles single candidate", () => {
      const candidates = [createScoredCandidate()];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.memories).toHaveLength(1);
      expect(result.contextBlock.memories[0].rank).toBe(1);
    });

    it("handles very large candidate set", () => {
      const candidates = Array.from({ length: 1000 }, (_, i) =>
        createScoredCandidate({ bucketId: `b${i}` })
      );

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.totalCandidates).toBe(1000);
      expect(result.contextBlock.memories.length).toBeGreaterThan(0);
    });

    it("handles equal scores", () => {
      const candidates = [
        createScoredCandidate({ bucketId: "b1" }),
        createScoredCandidate({ bucketId: "b2" }),
        createScoredCandidate({ bucketId: "b3" }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.memories.length).toBeGreaterThanOrEqual(1);
    });
  });
});
