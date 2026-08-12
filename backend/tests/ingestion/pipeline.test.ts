import { IngestionPipeline } from "../../src/ingestion/pipeline";
import { TextNormalizer } from "../../src/ingestion/normalizer";
import { ConceptExtractor } from "../../src/ingestion/extractor";
import { RelationshipMapper } from "../../src/ingestion/relationship-mapper";
import { EmbeddingGenerator } from "../../src/ingestion/embedding-generator";
import type { NormalizedChunk } from "../../src/ingestion/normalizer";
import type { RawConceptFromAI } from "../../src/models/concept.model";

function createMockNormalizer(chunks?: NormalizedChunk[]): TextNormalizer {
  const normalizer = new TextNormalizer();
  if (chunks) {
    jest.spyOn(normalizer, "normalizeMessage").mockReturnValue(chunks);
    jest.spyOn(normalizer, "normalizeDocument").mockReturnValue(chunks);
  }
  return normalizer;
}

function createMockExtractor(concepts?: any[]): jest.Mocked<ConceptExtractor> {
  const mock = {
    extractFromChunks: jest.fn().mockResolvedValue({
      concepts: concepts ?? [
        {
          label: "Test Concept",
          definition: "A test concept",
          conceptType: "fact",
          importance: 7,
          source: "test",
          relatedTerms: [],
          embedding: Array(1536).fill(0.1),
        },
      ],
      chunksProcessed: 1,
      chunksFailed: 0,
      extractionTimeMs: 100,
    }),
    extractFromChunk: jest.fn(),
  } as unknown as jest.Mocked<ConceptExtractor>;
  return mock;
}

function createMockRelationshipMapper(): jest.Mocked<RelationshipMapper> {
  return {
    mapRelationships: jest.fn().mockResolvedValue({
      relationships: [
        {
          sourceBucket: "Concept A",
          targetBucket: "Concept B",
          relationType: "related_to",
          confidence: 0.8,
          sourceText: "test",
        },
      ],
      withinChunkCount: 1,
      crossChunkCount: 0,
      mappingTimeMs: 50,
    }),
  } as unknown as jest.Mocked<RelationshipMapper>;
}

function createMockEmbeddingGenerator(): jest.Mocked<EmbeddingGenerator> {
  return {
    validateEmbedding: jest.fn().mockReturnValue(true),
    generate: jest.fn(),
    generateBatch: jest.fn(),
    generateForConcept: jest.fn(),
    generateForQuery: jest.fn(),
  } as unknown as jest.Mocked<EmbeddingGenerator>;
}

function createMockRawStore() {
  return {
    storeMessage: jest.fn().mockResolvedValue("msg-123"),
    storeChunk: jest.fn().mockResolvedValue("chunk-123"),
    storeDocument: jest.fn().mockResolvedValue("doc-123"),
  };
}

function createMockBucketStore() {
  return {
    getOrCreateBucket: jest.fn().mockResolvedValue({ bucketId: "bucket-123", isNew: true }),
  };
}

function createMockEmbeddingStore() {
  return {
    storeEmbedding: jest.fn().mockResolvedValue(undefined),
  };
}

describe("IngestionPipeline", () => {
  let pipeline: IngestionPipeline;
  let mockRawStore: ReturnType<typeof createMockRawStore>;
  let mockBucketStore: ReturnType<typeof createMockBucketStore>;
  let mockEmbeddingStore: ReturnType<typeof createMockEmbeddingStore>;

  beforeEach(() => {
    mockRawStore = createMockRawStore();
    mockBucketStore = createMockBucketStore();
    mockEmbeddingStore = createMockEmbeddingStore();
  });

  function createPipeline(overrides?: {
    extractorConcepts?: any[];
    relationshipResult?: any;
  }) {
    const normalizer = createMockNormalizer([
      {
        text: "Normalized chunk text",
        role: "user",
        source: "chat:session-1",
        sessionId: "session-1",
        timestamp: "2024-01-01",
        chunkIndex: 0,
        tokenEstimate: 5,
      },
    ]);

    const extractor = createMockExtractor(overrides?.extractorConcepts);
    const relationshipMapper = createMockRelationshipMapper();
    const embeddingGenerator = createMockEmbeddingGenerator();

    if (overrides?.relationshipResult) {
      (relationshipMapper.mapRelationships as jest.Mock).mockResolvedValue(overrides.relationshipResult);
    }

    return new IngestionPipeline({
      normalizer,
      extractor,
      relationshipMapper,
      embeddingGenerator,
      rawStore: mockRawStore,
      bucketStore: mockBucketStore,
      embeddingStore: mockEmbeddingStore,
    });
  }

  describe("ingestMessage", () => {
    it("stores the raw message", async () => {
      pipeline = createPipeline();
      await pipeline.ingestMessage("user", "Hello world", "chat:1", "session-1", "2024-01-01");

      expect(mockRawStore.storeMessage).toHaveBeenCalledWith(
        "session-1",
        "user",
        "Hello world",
        "2024-01-01"
      );
    });

    it("stores chunks from normalized content", async () => {
      pipeline = createPipeline();
      await pipeline.ingestMessage("user", "Hello world", "chat:1", "session-1", "2024-01-01");

      expect(mockRawStore.storeChunk).toHaveBeenCalledWith(
        "msg-123",
        "Normalized chunk text",
        expect.objectContaining({
          role: "user",
          source: "chat:session-1",
          sessionId: "session-1",
        })
      );
    });

    it("extracts and stores concepts as buckets", async () => {
      pipeline = createPipeline();
      const result = await pipeline.ingestMessage("user", "Hello", "chat:1", "session-1", "2024-01-01");

      expect(mockBucketStore.getOrCreateBucket).toHaveBeenCalledWith(
        "Test Concept",
        "A test concept",
        "fact",
        7,
        expect.any(String)
      );
      expect(result.conceptsExtracted).toBe(1);
    });

    it("stores embeddings for concepts with valid vectors", async () => {
      pipeline = createPipeline();
      await pipeline.ingestMessage("user", "Hello", "chat:1", "session-1", "2024-01-01");

      expect(mockEmbeddingStore.storeEmbedding).toHaveBeenCalledWith(
        "bucket-123",
        expect.any(Array)
      );
    });

    it("maps and stores relationships", async () => {
      pipeline = createPipeline();
      const result = await pipeline.ingestMessage("user", "Hello", "chat:1", "session-1", "2024-01-01");

      expect(result.relationshipsMapped).toBe(1);
    });

    it("returns correct ingestion stats for new buckets", async () => {
      mockBucketStore.getOrCreateBucket.mockResolvedValue({ bucketId: "bucket-1", isNew: true });
      pipeline = createPipeline();

      const result = await pipeline.ingestMessage("user", "Hello", "chat:1", "session-1", "2024-01-01");

      expect(result.newBuckets).toBe(1);
      expect(result.mergedBuckets).toBe(0);
      expect(result.chunksProcessed).toBe(1);
      expect(result.chunksFailed).toBe(0);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("returns correct stats for merged buckets", async () => {
      mockBucketStore.getOrCreateBucket.mockResolvedValue({ bucketId: "bucket-1", isNew: false });
      pipeline = createPipeline();

      const result = await pipeline.ingestMessage("user", "Hello", "chat:1", "session-1", "2024-01-01");

      expect(result.newBuckets).toBe(0);
      expect(result.mergedBuckets).toBe(1);
    });

    it("returns empty result for empty content", async () => {
      pipeline = createPipeline();
      const result = await pipeline.ingestMessage("user", "", "chat:1", "session-1", "2024-01-01");

      expect(result.conceptsExtracted).toBe(0);
      expect(result.newBuckets).toBe(0);
      expect(result.mergedBuckets).toBe(0);
      expect(result.relationshipsMapped).toBe(0);
      expect(result.chunksProcessed).toBe(0);
      expect(mockRawStore.storeMessage).not.toHaveBeenCalled();
    });

    it("returns empty result when normalization yields no chunks", async () => {
      const normalizer = createMockNormalizer([]);
      const extractor = createMockExtractor();
      const pipeline = new IngestionPipeline({
        normalizer,
        extractor,
        relationshipMapper: createMockRelationshipMapper(),
        embeddingGenerator: createMockEmbeddingGenerator(),
        rawStore: mockRawStore,
        bucketStore: mockBucketStore,
        embeddingStore: mockEmbeddingStore,
      });

      const result = await pipeline.ingestMessage("user", "Hi", "chat:1", "session-1", "2024-01-01");

      expect(result.conceptsExtracted).toBe(0);
    });

    it("handles raw store failure by throwing", async () => {
      mockRawStore.storeMessage.mockRejectedValue(new Error("DB connection lost"));
      pipeline = createPipeline();

      await expect(
        pipeline.ingestMessage("user", "Hello", "chat:1", "session-1", "2024-01-01")
      ).rejects.toThrow("DB connection lost");
    });

    it("continues when relationship mapping fails", async () => {
      pipeline = createPipeline({
        relationshipResult: {
          relationships: [],
          withinChunkCount: 0,
          crossChunkCount: 0,
          mappingTimeMs: 0,
        },
      });
      (pipeline as any).relationshipMapper.mapRelationships.mockRejectedValue(new Error("Relationship failed"));

      const result = await pipeline.ingestMessage("user", "Hello", "chat:1", "session-1", "2024-01-01");

      expect(result.relationshipsMapped).toBe(0);
      expect(result.conceptsExtracted).toBe(1);
    });

    it("continues when embedding store fails for a concept", async () => {
      mockEmbeddingStore.storeEmbedding.mockRejectedValue(new Error("Embedding store full"));
      pipeline = createPipeline();

      const result = await pipeline.ingestMessage("user", "Hello", "chat:1", "session-1", "2024-01-01");

      expect(result.conceptsExtracted).toBe(1);
      expect(result.newBuckets).toBe(1);
    });

    it("handles multiple concepts from single chunk", async () => {
      pipeline = createPipeline({
        extractorConcepts: [
          { label: "Concept A", definition: "Def A", conceptType: "fact", importance: 5, source: "test", relatedTerms: [], embedding: Array(1536).fill(0.1) },
          { label: "Concept B", definition: "Def B", conceptType: "code", importance: 8, source: "test", relatedTerms: [], embedding: Array(1536).fill(0.2) },
          { label: "Concept C", definition: "Def C", conceptType: "decision", importance: 6, source: "test", relatedTerms: [], embedding: Array(1536).fill(0.3) },
        ],
      });

      const result = await pipeline.ingestMessage("user", "Hello", "chat:1", "session-1", "2024-01-01");

      expect(result.conceptsExtracted).toBe(3);
      expect(mockBucketStore.getOrCreateBucket).toHaveBeenCalledTimes(3);
    });
  });

  describe("ingestDocument", () => {
    it("stores the document", async () => {
      pipeline = createPipeline();
      const result = await pipeline.ingestDocument("Document content here", "test.txt", ".txt");

      expect(mockRawStore.storeDocument).toHaveBeenCalledWith("test.txt", ".txt", "Document content here");
      expect(result.documentId).toBe("doc-123");
      expect(result.filename).toBe("test.txt");
      expect(result.status).toBe("complete");
    });

    it("returns empty status for empty content", async () => {
      pipeline = createPipeline();
      const result = await pipeline.ingestDocument("", "empty.txt", ".txt");

      expect(result.status).toBe("empty");
      expect(result.documentId).toBe("");
      expect(result.conceptsExtracted).toBe(0);
    });

    it("throws when document storage fails", async () => {
      mockRawStore.storeDocument.mockRejectedValue(new Error("Storage error"));
      pipeline = createPipeline();

      await expect(
        pipeline.ingestDocument("Content", "test.txt", ".txt")
      ).rejects.toThrow("Storage error");
    });

    it("returns ingestion stats for documents", async () => {
      pipeline = createPipeline();
      const result = await pipeline.ingestDocument("Content about React hooks and state management", "react.md", ".md");

      expect(result.conceptsExtracted).toBeGreaterThanOrEqual(1);
      expect(result.newBuckets).toBeGreaterThanOrEqual(1);
      expect(result.chunksProcessed).toBeGreaterThanOrEqual(1);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});