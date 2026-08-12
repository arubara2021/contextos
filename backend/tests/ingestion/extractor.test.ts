import { ConceptExtractor, BedrockClient } from "../../src/ingestion/extractor";
import type { RawConceptFromAI } from "../../src/models/concept.model";
import type { NormalizedChunk } from "../../src/ingestion/normalizer";

function createMockBedrockClient(overrides?: {
  extractResult?: RawConceptFromAI[];
  extractError?: Error;
  embeddingResult?: number[];
  embeddingError?: Error;
}): BedrockClient {
  return {
    extractConcepts: jest.fn().mockImplementation(async () => {
      if (overrides?.extractError) throw overrides.extractError;
      return overrides?.extractResult ?? [
        {
          label: "Test Concept",
          definition: "A concept used for testing",
          type: "fact",
          importance: 7,
          related: ["testing", "unit tests"],
        },
      ];
    }),
    generateEmbedding: jest.fn().mockImplementation(async () => {
      if (overrides?.embeddingError) throw overrides.embeddingError;
      return overrides?.embeddingResult ?? Array(1536).fill(0).map(() => Math.random());
    }),
  };
}

function createChunk(overrides?: Partial<NormalizedChunk>): NormalizedChunk {
  return {
    text: "This is a test chunk about TypeScript and testing frameworks.",
    role: "user",
    source: "chat:session-1",
    sessionId: "session-1",
    timestamp: "2024-01-01T00:00:00Z",
    chunkIndex: 0,
    tokenEstimate: 12,
    ...overrides,
  };
}

describe("ConceptExtractor", () => {
  describe("extractFromChunks", () => {
    it("extracts concepts from chunks successfully", async () => {
      const mockClient = createMockBedrockClient({
        extractResult: [
          {
            label: "TypeScript",
            definition: "A typed superset of JavaScript",
            type: "code",
            importance: 8,
            related: ["JavaScript", "types"],
          },
          {
            label: "Testing Framework",
            definition: "Tools for automated software testing",
            type: "fact",
            importance: 6,
            related: ["Jest", "unit tests"],
          },
        ],
      });

      const extractor = new ConceptExtractor(mockClient);
      const chunks = [createChunk()];
      const result = await extractor.extractFromChunks(chunks);

      expect(result.concepts).toHaveLength(2);
      expect(result.chunksProcessed).toBe(1);
      expect(result.chunksFailed).toBe(0);
      expect(result.extractionTimeMs).toBeGreaterThanOrEqual(0);
      expect(result.concepts[0].label).toBe("TypeScript");
      expect(result.concepts[0].definition).toBe("A typed superset of JavaScript");
      expect(result.concepts[0].conceptType).toBe("code");
      expect(result.concepts[0].importance).toBe(8);
      expect(result.concepts[0].source).toBe("chat:session-1, 2024-01-01T00:00:00Z");
      expect(result.concepts[0].embedding).toBeDefined();
      expect(result.concepts[0].embedding?.length).toBe(1536);
    });

    it("handles empty chunks array", async () => {
      const mockClient = createMockBedrockClient();
      const extractor = new ConceptExtractor(mockClient);
      const result = await extractor.extractFromChunks([]);

      expect(result.concepts).toHaveLength(0);
      expect(result.chunksProcessed).toBe(0);
      expect(result.chunksFailed).toBe(0);
    });

    it("deduplicates concepts with same label", async () => {
      const mockClient = createMockBedrockClient({
        extractResult: [
          { label: "TypeScript", definition: "Definition A", type: "fact", importance: 5, related: [] },
          { label: "TypeScript", definition: "Definition B", type: "code", importance: 8, related: [] },
        ],
      });

      const extractor = new ConceptExtractor(mockClient);
      const result = await extractor.extractFromChunks([createChunk()]);

      expect(result.concepts).toHaveLength(1);
      expect(result.concepts[0].importance).toBe(8);
    });

    it("handles extraction failure gracefully", async () => {
      const mockClient = createMockBedrockClient({
        extractError: new Error("Bedrock API error"),
      });

      const extractor = new ConceptExtractor(mockClient, 0);
      const result = await extractor.extractFromChunks([createChunk()]);

      expect(result.concepts).toHaveLength(0);
      expect(result.chunksProcessed).toBe(0);
      expect(result.chunksFailed).toBe(1);
    });

    it("handles embedding failure without failing concept", async () => {
      const mockClient = createMockBedrockClient({
        extractResult: [
          { label: "Concept", definition: "A concept", type: "fact", importance: 5, related: [] },
        ],
        embeddingError: new Error("Embedding failed"),
      });

      const extractor = new ConceptExtractor(mockClient, 0);
      const result = await extractor.extractFromChunks([createChunk()]);

      expect(result.concepts).toHaveLength(1);
      expect(result.concepts[0].embedding).toBeNull();
    });

    it("processes multiple chunks", async () => {
      let callCount = 0;
      const mockClient = createMockBedrockClient();
      (mockClient.extractConcepts as jest.Mock).mockImplementation(async () => {
        callCount++;
        return [
          { label: `Concept ${callCount}`, definition: `Definition ${callCount}`, type: "fact", importance: 5, related: [] },
        ];
      });

      const extractor = new ConceptExtractor(mockClient);
      const chunks = [
        createChunk({ text: "First chunk content.", chunkIndex: 0 }),
        createChunk({ text: "Second chunk content.", chunkIndex: 1 }),
        createChunk({ text: "Third chunk content.", chunkIndex: 2 }),
      ];

      const result = await extractor.extractFromChunks(chunks);

      expect(result.concepts).toHaveLength(3);
      expect(result.chunksProcessed).toBe(3);
      expect(result.chunksFailed).toBe(0);
    });

    it("continues processing after individual chunk failure", async () => {
      let callCount = 0;
      const mockClient = createMockBedrockClient();
      (mockClient.extractConcepts as jest.Mock).mockImplementation(async () => {
        callCount++;
        if (callCount === 2) throw new Error("Chunk 2 failed");
        return [
          { label: `Concept ${callCount}`, definition: `Def ${callCount}`, type: "fact", importance: 5, related: [] },
        ];
      });

      const extractor = new ConceptExtractor(mockClient, 0);
      const chunks = [
        createChunk({ text: "Chunk 1", chunkIndex: 0 }),
        createChunk({ text: "Chunk 2", chunkIndex: 1 }),
        createChunk({ text: "Chunk 3", chunkIndex: 2 }),
      ];

      const result = await extractor.extractFromChunks(chunks);

      expect(result.chunksProcessed).toBe(2);
      expect(result.chunksFailed).toBe(1);
      expect(result.concepts.length).toBeGreaterThanOrEqual(1);
    });

    it("filters out invalid concepts", async () => {
      const mockClient = createMockBedrockClient({
        extractResult: [
          { label: "", definition: "No label", type: "fact", importance: 5, related: [] },
          { label: "Valid", definition: "", type: "fact", importance: 5, related: [] },
          { label: "Valid Concept", definition: "Has both fields", type: "fact", importance: 5, related: [] },
          { label: 123 as any, definition: true as any, type: "fact", importance: 5, related: [] },
        ],
      });

      const extractor = new ConceptExtractor(mockClient, 0);
      const result = await extractor.extractFromChunks([createChunk()]);

      expect(result.concepts).toHaveLength(1);
      expect(result.concepts[0].label).toBe("Valid Concept");
    });

    it("clamps importance to 1-10 range", async () => {
      const mockClient = createMockBedrockClient({
        extractResult: [
          { label: "High", definition: "Very important", type: "fact", importance: 15, related: [] },
          { label: "Low", definition: "Not important", type: "fact", importance: -3, related: [] },
          { label: "Mid", definition: "Medium", type: "fact", importance: 5.7, related: [] },
        ],
      });

      const extractor = new ConceptExtractor(mockClient, 0);
      const result = await extractor.extractFromChunks([createChunk()]);

      expect(result.concepts).toHaveLength(3);
      expect(result.concepts.find((c) => c.label === "High")?.importance).toBe(10);
      expect(result.concepts.find((c) => c.label === "Low")?.importance).toBe(1);
      expect(result.concepts.find((c) => c.label === "Mid")?.importance).toBe(6);
    });

    it("defaults concept type to fact when invalid", async () => {
      const mockClient = createMockBedrockClient({
        extractResult: [
          { label: "Concept", definition: "A concept", type: "invalid_type", importance: 5, related: [] },
        ],
      });

      const extractor = new ConceptExtractor(mockClient, 0);
      const result = await extractor.extractFromChunks([createChunk()]);

      expect(result.concepts[0].conceptType).toBe("fact");
    });

    it("handles non-array extraction results", async () => {
      const mockClient = createMockBedrockClient({
        extractResult: { label: "Single", definition: "Object", type: "fact", importance: 5, related: [] } as any,
      });

      const extractor = new ConceptExtractor(mockClient, 0);
      const result = await extractor.extractFromChunks([createChunk()]);

      expect(result.concepts).toHaveLength(1);
    });
  });

  describe("extractFromChunk", () => {
    it("returns empty array for empty text", async () => {
      const mockClient = createMockBedrockClient();
      const extractor = new ConceptExtractor(mockClient);
      const result = await extractor.extractFromChunk("", {
        source: "test",
        sessionId: "session-1",
        role: "user",
      });

      expect(result).toEqual([]);
      expect(mockClient.extractConcepts).not.toHaveBeenCalled();
    });

    it("returns empty array for whitespace-only text", async () => {
      const mockClient = createMockBedrockClient();
      const extractor = new ConceptExtractor(mockClient);
      const result = await extractor.extractFromChunk("   \n\n   ", {
        source: "test",
        sessionId: "session-1",
        role: "user",
      });

      expect(result).toEqual([]);
    });

    it("attaches source metadata correctly", async () => {
      const mockClient = createMockBedrockClient();
      const extractor = new ConceptExtractor(mockClient, 0);
      const result = await extractor.extractFromChunk(
        "Content about React hooks",
        { source: "chat:session-1", timestamp: "2024-06-15T10:00:00Z", sessionId: "session-1", role: "user" }
      );

      expect(result[0].source).toBe("chat:session-1, 2024-06-15T10:00:00Z");
    });

    it("generates embeddings for extracted concepts", async () => {
      const embedding = Array(1536).fill(0.1);
      const mockClient = createMockBedrockClient({ embeddingResult: embedding });
      const extractor = new ConceptExtractor(mockClient, 0);
      const result = await extractor.extractFromChunk("Test content", {
        source: "test",
        sessionId: "session-1",
        role: "user",
      });

      expect(result[0].embedding).toEqual(embedding);
      expect(mockClient.generateEmbedding).toHaveBeenCalled();
    });

    it("validates related terms as array", async () => {
      const mockClient = createMockBedrockClient({
        extractResult: [
          {
            label: "Concept",
            definition: "Definition",
            type: "fact",
            importance: 5,
            related: ["valid", "", 123 as any, "also-valid", null as any],
          },
        ],
      });

      const extractor = new ConceptExtractor(mockClient, 0);
      const result = await extractor.extractFromChunk("Test", {
        source: "test",
        sessionId: "session-1",
        role: "user",
      });

      expect(result[0].relatedTerms).toEqual(["valid", "also-valid"]);
    });
  });
});