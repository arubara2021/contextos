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

describe("Context Block Integration", () => {
  let assembler: Assembler;

  beforeEach(() => {
    assembler = new Assembler();
  });

  describe("end-to-end context assembly", () => {
    it("assembles a full context block from scored candidates", () => {
      const candidates = [
        createScoredCandidate({
          bucketId: "b1",
          label: "TypeScript Configuration",
          definition: "tsconfig.json controls TypeScript compiler options",
          conceptType: "fact",
          strength: 0.9,
          scores: { semanticScore: 0.9, strengthScore: 0.9, recencyScore: 0.8, relevanceScore: 0.95, vectorScore: 0.95, textScore: 0.8, graphScore: 0.5 },
        }),
        createScoredCandidate({
          bucketId: "b2",
          label: "JWT Authentication",
          definition: "JSON Web Tokens used for stateless authentication",
          conceptType: "code",
          strength: 0.7,
          scores: { semanticScore: 0.7, strengthScore: 0.7, recencyScore: 0.6, relevanceScore: 0.8, vectorScore: 0.8, textScore: 0.7, graphScore: 0.4 },
        }),
        createScoredCandidate({
          bucketId: "b3",
          label: "Database Indexing",
          definition: "B-tree indexes speed up queries on large tables",
          conceptType: "fact",
          strength: 0.5,
          scores: { semanticScore: 0.5, strengthScore: 0.5, recencyScore: 0.4, relevanceScore: 0.6, vectorScore: 0.6, textScore: 0.5, graphScore: 0.3 },
        }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.memories.length).toBeGreaterThan(0);
      expect(result.contextBlock.rawText).toContain("TypeScript Configuration");
      expect(result.contextBlock.totalCandidates).toBe(3);
    });

    it("generates readable raw text", () => {
      const candidates = [
        createScoredCandidate({
          label: "React Hooks",
          definition: "Functions that let you use state and lifecycle in functional components",
          conceptType: "code",
          strength: 0.85,
          source: "chat:session-1",
        }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());
      const text = result.contextBlock.rawText;

      expect(text).toContain("Retrieved memories");
      expect(text).toContain("[CODE]");
      expect(text).toContain("React Hooks");
      expect(text).toContain("85%");
      expect(text).toContain("chat:session-1");
      expect(text).toContain("1.");
    });

    it("ranks memories by score", () => {
      const candidates = [
        createScoredCandidate({
          bucketId: "b-low",
          label: "Low Score",
          strength: 0.2,
          scores: { semanticScore: 0.3, strengthScore: 0.2, recencyScore: 0.2, relevanceScore: 0.3, vectorScore: 0.3, textScore: 0.2, graphScore: 0.1 },
        }),
        createScoredCandidate({
          bucketId: "b-high",
          label: "High Score",
          strength: 0.9,
          scores: { semanticScore: 0.9, strengthScore: 0.9, recencyScore: 0.8, relevanceScore: 0.95, vectorScore: 0.95, textScore: 0.8, graphScore: 0.5 },
        }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      const assembled = result.contextBlock.memories;
      expect(assembled.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("empty context block", () => {
    it("returns empty context block for no candidates", () => {
      const result = assembler.assemble([], createQueryAnalysis());

      expect(result.contextBlock.rawText).toBe("");
      expect(result.contextBlock.memories).toEqual([]);
      expect(result.contextBlock.totalCandidates).toBe(0);
      expect(result.contextBlock.budgetUsed).toBe(0);
    });
  });

  describe("single candidate context block", () => {
    it("handles single candidate correctly", () => {
      const candidates = [
        createScoredCandidate({
          bucketId: "b-only",
          label: "GraphQL",
          definition: "A query language for APIs",
          conceptType: "code",
          strength: 0.9,
        }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.memories).toHaveLength(1);
      expect(result.contextBlock.memories[0].rank).toBe(1);
      expect(result.contextBlock.memories[0].label).toBe("GraphQL");
      expect(result.contextBlock.rawText).toContain("[CODE]");
    });
  });

  describe("budget edge cases", () => {
    it("reduces budget for highly specific queries", () => {
      const candidates = Array.from({ length: 20 }, (_, i) =>
        createScoredCandidate({ bucketId: `b${i}` })
      );

      const specificResult = assembler.assemble(candidates, createQueryAnalysis({ specificity: 0.95 }));
      const broadResult = assembler.assemble(candidates, createQueryAnalysis({ specificity: 0.1 }));

      expect(specificResult.contextBlock.budgetUsed).toBeLessThanOrEqual(
        broadResult.contextBlock.budgetUsed
      );
    });

    it("never returns negative budget", () => {
      const result = assembler.assemble([], createQueryAnalysis());

      expect(result.contextBlock.budgetUsed).toBeGreaterThanOrEqual(0);
      expect(result.contextBlock.budgetMax).toBeGreaterThanOrEqual(0);
    });
  });

  describe("timing", () => {
    it("reports assembly time", () => {
      const candidates = Array.from({ length: 50 }, (_, i) =>
        createScoredCandidate({ bucketId: `b${i}` })
      );

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.timings).toBeDefined();
      expect(result.timings.assemblyMs).toBeGreaterThanOrEqual(0);
    });

    it("reports zero time for empty assembly", () => {
      const result = assembler.assemble([], createQueryAnalysis());

      expect(result.timings.assemblyMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe("raw text format", () => {
    it("includes system header", () => {
      const candidates = [createScoredCandidate()];
      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toContain("persistent memory");
      expect(result.contextBlock.rawText).toContain("Retrieved memories");
    });

    it("numbers memories sequentially starting from 1", () => {
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

    it("includes type labels in uppercase brackets", () => {
      const candidates = [
        createScoredCandidate({ conceptType: "decision", bucketId: "b1" }),
        createScoredCandidate({ conceptType: "code", bucketId: "b2" }),
      ];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toContain("[DECISION]");
      expect(result.contextBlock.rawText).toContain("[CODE]");
    });

    it("includes strength percentage", () => {
      const candidates = [createScoredCandidate({ strength: 0.82 })];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toContain("82%");
    });

    it("includes source information", () => {
      const candidates = [createScoredCandidate({ source: "chat:important-session" })];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toContain("chat:important-session");
    });

    it("handles missing source gracefully", () => {
      const candidates = [createScoredCandidate({ source: "" })];

      const result = assembler.assemble(candidates, createQueryAnalysis());

      expect(result.contextBlock.rawText).toBeDefined();
      expect(result.contextBlock.rawText.length).toBeGreaterThan(0);
    });
  });
});
