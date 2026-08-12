import { Retriever, RetrievalCandidate } from "../../src/injection/retriever";
import type { QueryAnalysis } from "../../src/injection/query-analyzer";

function createMockEmbeddingSearcher() {
  return {
    generateEmbedding: jest.fn().mockResolvedValue(Array(1536).fill(0.1)),
    searchSimilar: jest.fn().mockResolvedValue([
      { bucketId: "b1", similarity: 0.92 },
      { bucketId: "b2", similarity: 0.85 },
    ]),
  };
}

function createMockTextSearcher() {
  return {
    searchBuckets: jest.fn().mockResolvedValue([
      { bucketId: "b1", canonical: "TypeScript", strength: 0.8 },
    ]),
  };
}

function createMockGraphSearcher() {
  return {
    getMultiHop: jest.fn().mockResolvedValue([
      { sourceBucket: "b1", targetBucket: "b3", relationType: "related_to", confidence: 0.7 },
    ]),
  };
}

function createMockMetadataProvider() {
  return {
    getBucketById: jest.fn().mockImplementation((bucketId: string) => {
      return Promise.resolve({
        bucket: {
          bucketId,
          canonical: "Test Concept",
          strength: 0.8,
          importance: 7,
          conceptType: "fact",
          lastAccessed: new Date("2024-06-01"),
          accessCount: 5,
          decayRate: 0.15,
        },
        items: [
          { label: "Test Concept", definition: "A test concept", source: "chat:session-1" },
        ],
      });
    }),
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

describe("Retriever", () => {
  let retriever: Retriever;
  let embeddingSearcher: ReturnType<typeof createMockEmbeddingSearcher>;
  let textSearcher: ReturnType<typeof createMockTextSearcher>;
  let graphSearcher: ReturnType<typeof createMockGraphSearcher>;
  let metadataProvider: ReturnType<typeof createMockMetadataProvider>;

  beforeEach(() => {
    embeddingSearcher = createMockEmbeddingSearcher();
    textSearcher = createMockTextSearcher();
    graphSearcher = createMockGraphSearcher();
    metadataProvider = createMockMetadataProvider();

    retriever = new Retriever({
      embeddingSearcher,
      textSearcher,
      graphSearcher,
      metadataProvider,
    });
  });

  describe("retrieve", () => {
    it("returns candidates from combined search", async () => {
      const result = await retriever.retrieve("TypeScript configuration", createQueryAnalysis());

      expect(result.candidates.length).toBeGreaterThan(0);
      expect(result.timings.totalMs).toBeGreaterThanOrEqual(0);
    });

    it("deduplicates results from multiple search methods", async () => {
      embeddingSearcher.searchSimilar.mockResolvedValue([
        { bucketId: "b1", similarity: 0.9 },
      ]);
      textSearcher.searchBuckets.mockResolvedValue([
        { bucketId: "b1", canonical: "TypeScript", strength: 0.8 },
      ]);

      const result = await retriever.retrieve("TypeScript", createQueryAnalysis());

      const ids = result.candidates.map((c) => c.bucketId);
      const uniqueIds = [...new Set(ids)];
      expect(ids.length).toBe(uniqueIds.length);
    });

    it("returns empty results for empty query", async () => {
      embeddingSearcher.searchSimilar.mockResolvedValue([]);
      textSearcher.searchBuckets.mockResolvedValue([]);
      graphSearcher.getMultiHop.mockResolvedValue([]);

      const result = await retriever.retrieve("", createQueryAnalysis({ keyTerms: [] }));

      expect(result.candidates).toEqual([]);
    });

    it("handles vector search failure gracefully", async () => {
      embeddingSearcher.generateEmbedding.mockRejectedValue(new Error("Embedding service down"));

      const result = await retriever.retrieve("test query", createQueryAnalysis());

      expect(result).toBeDefined();
      expect(result.timings.vectorMs).toBe(0);
    });

    it("handles text search failure gracefully", async () => {
      textSearcher.searchBuckets.mockRejectedValue(new Error("Text search down"));

      const result = await retriever.retrieve("test query", createQueryAnalysis());

      expect(result).toBeDefined();
    });

    it("includes timing information", async () => {
      const result = await retriever.retrieve("test", createQueryAnalysis());

      expect(result.timings).toHaveProperty("vectorMs");
      expect(result.timings).toHaveProperty("textMs");
      expect(result.timings).toHaveProperty("graphMs");
      expect(result.timings).toHaveProperty("enrichmentMs");
      expect(result.timings).toHaveProperty("totalMs");
    });

    it("enriches candidates with metadata", async () => {
      const result = await retriever.retrieve("test", createQueryAnalysis());

      if (result.candidates.length > 0) {
        const candidate = result.candidates[0];
        expect(candidate).toHaveProperty("bucketId");
        expect(candidate).toHaveProperty("label");
        expect(candidate).toHaveProperty("definition");
        expect(candidate).toHaveProperty("conceptType");
        expect(candidate).toHaveProperty("strength");
        expect(candidate).toHaveProperty("importance");
        expect(candidate).toHaveProperty("scores");
      }
    });

    it("sorts candidates by combined score descending", async () => {
      const result = await retriever.retrieve("test", createQueryAnalysis());

      for (let i = 1; i < result.candidates.length; i++) {
        expect(result.candidates[i - 1].scores.combinedScore).toBeGreaterThanOrEqual(
          result.candidates[i].scores.combinedScore
        );
      }
    });

    it("calls embedding searcher with query", async () => {
      await retriever.retrieve("TypeScript config", createQueryAnalysis());

      expect(embeddingSearcher.generateEmbedding).toHaveBeenCalledWith("TypeScript config");
    });

    it("calls text searcher with key terms", async () => {
      await retriever.retrieve("TypeScript config", createQueryAnalysis({ keyTerms: ["typescript"] }));

      expect(textSearcher.searchBuckets).toHaveBeenCalled();
    });
  });
});
