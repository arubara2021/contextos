import { Scorer, ScoredCandidate } from "../../src/injection/scorer";
import type { RetrievalCandidate } from "../../src/injection/retriever";

function createCandidate(overrides?: Partial<RetrievalCandidate>): RetrievalCandidate {
  return {
    bucketId: "bucket-1",
    label: "TypeScript",
    definition: "A typed superset of JavaScript",
    conceptType: "fact",
    strength: 0.8,
    importance: 7,
    source: "chat:session-1",
    lastAccessed: new Date("2024-06-01"),
    accessCount: 5,
    decayRate: 0.15,
    scores: {
      vectorScore: 0.9,
      textScore: 0.7,
      graphScore: 0.5,
      combinedScore: 2.1,
    },
    ...overrides,
  };
}

describe("Scorer", () => {
  let scorer: Scorer;

  beforeEach(() => {
    scorer = new Scorer();
  });

  describe("score", () => {
    it("returns empty result for empty candidates", () => {
      const result = scorer.score([]);

      expect(result.scored).toEqual([]);
      expect(result.timings.scoringMs).toBe(0);
    });

    it("scores a single candidate", () => {
      const result = scorer.score([createCandidate()]);

      expect(result.scored).toHaveLength(1);
      expect(result.scored[0].scores.relevanceScore).toBeGreaterThanOrEqual(0);
      expect(result.scored[0].scores.relevanceScore).toBeLessThanOrEqual(1);
    });

    it("assigns ranks to scored candidates", () => {
      const result = scorer.score([
        createCandidate({ bucketId: "b1", scores: { vectorScore: 0.95, textScore: 0.8, graphScore: 0.5, combinedScore: 2.25 } }),
        createCandidate({ bucketId: "b2", scores: { vectorScore: 0.3, textScore: 0.2, graphScore: 0.1, combinedScore: 0.6 } }),
      ]);

      expect(result.scored[0].rank).toBe(1);
      expect(result.scored[1].rank).toBe(2);
    });

    it("sorts candidates by relevance score descending", () => {
      const result = scorer.score([
        createCandidate({ bucketId: "b1", strength: 0.2, scores: { vectorScore: 0.3, textScore: 0.2, graphScore: 0.1, combinedScore: 0.6 } }),
        createCandidate({ bucketId: "b2", strength: 0.9, scores: { vectorScore: 0.95, textScore: 0.8, graphScore: 0.5, combinedScore: 2.25 } }),
        createCandidate({ bucketId: "b3", strength: 0.5, scores: { vectorScore: 0.6, textScore: 0.5, graphScore: 0.3, combinedScore: 1.4 } }),
      ]);

      for (let i = 1; i < result.scored.length; i++) {
        expect(result.scored[i - 1].scores.relevanceScore).toBeGreaterThanOrEqual(
          result.scored[i].scores.relevanceScore
        );
      }
    });

    it("includes timing information", () => {
      const result = scorer.score([createCandidate()]);

      expect(result.timings).toHaveProperty("scoringMs");
      expect(result.timings).toHaveProperty("normalizationMs");
      expect(result.timings).toHaveProperty("tieBreakingMs");
    });

    it("preserves candidate fields", () => {
      const candidate = createCandidate({
        bucketId: "b-custom",
        label: "Custom Label",
        definition: "Custom definition",
        conceptType: "decision",
        source: "chat:custom",
      });

      const result = scorer.score([candidate]);

      expect(result.scored[0].bucketId).toBe("b-custom");
      expect(result.scored[0].label).toBe("Custom Label");
      expect(result.scored[0].definition).toBe("Custom definition");
      expect(result.scored[0].conceptType).toBe("decision");
      expect(result.scored[0].source).toBe("chat:custom");
    });

    it("scores stronger candidates higher", () => {
      const strong = createCandidate({
        bucketId: "strong",
        strength: 0.95,
        scores: { vectorScore: 0.5, textScore: 0.5, graphScore: 0.5, combinedScore: 1.5 },
      });
      const weak = createCandidate({
        bucketId: "weak",
        strength: 0.1,
        scores: { vectorScore: 0.5, textScore: 0.5, graphScore: 0.5, combinedScore: 1.5 },
      });

      const result = scorer.score([strong, weak]);

      const strongScored = result.scored.find((s) => s.bucketId === "strong")!;
      const weakScored = result.scored.find((s) => s.bucketId === "weak")!;

      expect(strongScored.rank).toBeLessThan(weakScored.rank);
    });

    it("includes all sub-scores", () => {
      const result = scorer.score([createCandidate()]);

      const scores = result.scored[0].scores;
      expect(scores).toHaveProperty("semanticScore");
      expect(scores).toHaveProperty("strengthScore");
      expect(scores).toHaveProperty("recencyScore");
      expect(scores).toHaveProperty("relevanceScore");
      expect(scores).toHaveProperty("vectorScore");
      expect(scores).toHaveProperty("textScore");
      expect(scores).toHaveProperty("graphScore");
    });

    it("handles multiple candidates", () => {
      const candidates = Array.from({ length: 20 }, (_, i) =>
        createCandidate({
          bucketId: `b${i}`,
          strength: Math.random(),
          scores: {
            vectorScore: Math.random(),
            textScore: Math.random(),
            graphScore: Math.random(),
            combinedScore: Math.random() * 3,
          },
        })
      );

      const result = scorer.score(candidates);

      expect(result.scored).toHaveLength(20);
      result.scored.forEach((s) => {
        expect(s.rank).toBeGreaterThanOrEqual(1);
        expect(s.rank).toBeLessThanOrEqual(20);
      });
    });
  });
});
