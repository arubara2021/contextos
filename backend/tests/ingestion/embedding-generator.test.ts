import { EmbeddingGenerator } from "../../src/ingestion/embedding-generator";

function createMockClient(overrides?: {
  embedding?: number[];
  error?: Error;
}) {
  return {
    generateEmbedding: jest.fn().mockImplementation(async () => {
      if (overrides?.error) throw overrides.error;
      return overrides?.embedding ?? Array(1536).fill(0).map(() => Math.random());
    }),
  };
}

describe("EmbeddingGenerator", () => {
  describe("generate", () => {
    it("generates an embedding for valid text", async () => {
      const embedding = Array(1536).fill(0.1);
      const client = createMockClient({ embedding });
      const generator = new EmbeddingGenerator(client, 0, 0);

      const result = await generator.generate("Test text for embedding");

      expect(result).toHaveLength(1536);
      expect(client.generateEmbedding).toHaveBeenCalledWith("Test text for embedding");
    });

    it("trims input text", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 0, 0);

      await generator.generate("   Test text   ");

      expect(client.generateEmbedding).toHaveBeenCalledWith("Test text");
    });

    it("throws for empty text", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 0, 0);

      await expect(generator.generate("")).rejects.toThrow("empty");
      expect(client.generateEmbedding).not.toHaveBeenCalled();
    });

    it("throws for whitespace-only text", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 0, 0);

      await expect(generator.generate("   ")).rejects.toThrow("empty");
      expect(client.generateEmbedding).not.toHaveBeenCalled();
    });

    it("throws on API error", async () => {
      const client = createMockClient({ error: new Error("API timeout") });
      const generator = new EmbeddingGenerator(client, 0, 0);

      await expect(generator.generate("Test")).rejects.toThrow("API timeout");
    });

    it("retries on failure when maxRetries > 0", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 2, 0);

      (client.generateEmbedding as jest.Mock)
        .mockRejectedValueOnce(new Error("Timeout"))
        .mockResolvedValueOnce(Array(1536).fill(0.1));

      const result = await generator.generate("Test");

      expect(result).toHaveLength(1536);
      expect(client.generateEmbedding).toHaveBeenCalledTimes(2);
    });

    it("throws after max retries exhausted", async () => {
      const client = createMockClient({ error: new Error("timeout: service unavailable") });
      const generator = new EmbeddingGenerator(client, 2, 0);

      await expect(generator.generate("Test")).rejects.toThrow("timeout");
      expect(client.generateEmbedding).toHaveBeenCalledTimes(3);
    });

    it("throws for empty embedding response", async () => {
      const client = createMockClient({ embedding: [] });
      const generator = new EmbeddingGenerator(client, 0, 0);

      await expect(generator.generate("Test")).rejects.toThrow();
    });

    it("throws for non-array embedding response", async () => {
      const client = createMockClient({ embedding: "not-an-array" as any });
      const generator = new EmbeddingGenerator(client, 0, 0);

      await expect(generator.generate("Test")).rejects.toThrow();
    });

    it("throws for embedding with non-finite values", async () => {
      const embedding = Array(1536).fill(0.1);
      embedding[500] = NaN;
      const client = createMockClient({ embedding });
      const generator = new EmbeddingGenerator(client, 0, 0);

      await expect(generator.generate("Test")).rejects.toThrow("non-finite");
    });
  });

  describe("generateBatch", () => {
    it("generates embeddings for multiple texts", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 0, 0);

      const results = await generator.generateBatch(["Text 1", "Text 2", "Text 3"]);

      expect(results).toHaveLength(3);
      results.forEach((r) => {
        expect(r).not.toBeNull();
        expect(r!.length).toBe(1536);
      });
      expect(client.generateEmbedding).toHaveBeenCalledTimes(3);
    });

    it("returns null for failed items", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 0, 0);

      (client.generateEmbedding as jest.Mock)
        .mockResolvedValueOnce(Array(1536).fill(0.1))
        .mockRejectedValueOnce(new Error("Failed"))
        .mockResolvedValueOnce(Array(1536).fill(0.3));

      const results = await generator.generateBatch(["Good", "Bad", "Also Good"]);

      expect(results).toHaveLength(3);
      expect(results[0]).not.toBeNull();
      expect(results[1]).toBeNull();
      expect(results[2]).not.toBeNull();
    });

    it("returns empty array for empty input", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 0, 0);

      const results = await generator.generateBatch([]);

      expect(results).toEqual([]);
      expect(client.generateEmbedding).not.toHaveBeenCalled();
    });

    it("returns null for empty text items", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 0, 0);

      const results = await generator.generateBatch(["", "  ", "Valid"]);

      expect(results).toHaveLength(3);
      expect(results[0]).toBeNull();
      expect(results[1]).toBeNull();
      expect(results[2]).not.toBeNull();
    });
  });

  describe("generateForConcept", () => {
    it("combines label and definition", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 0, 0);

      await generator.generateForConcept("TypeScript", "A typed superset of JavaScript");

      expect(client.generateEmbedding).toHaveBeenCalledWith(
        "TypeScript: A typed superset of JavaScript"
      );
    });

    it("returns valid embedding", async () => {
      const embedding = Array(1536).fill(0.5);
      const client = createMockClient({ embedding });
      const generator = new EmbeddingGenerator(client, 0, 0);

      const result = await generator.generateForConcept("Test", "Definition");

      expect(result).toEqual(embedding);
    });
  });

  describe("generateForQuery", () => {
    it("generates embedding for query text", async () => {
      const client = createMockClient();
      const generator = new EmbeddingGenerator(client, 0, 0);

      await generator.generateForQuery("How to implement caching?");

      expect(client.generateEmbedding).toHaveBeenCalledWith(
        "How to implement caching?"
      );
    });
  });

  describe("validateEmbedding", () => {
    it("returns true for valid embedding", () => {
      const generator = new EmbeddingGenerator(createMockClient(), 1536, 0);
      const vector = Array(1536).fill(0.1);

      expect(generator.validateEmbedding(vector)).toBe(true);
    });

    it("returns false for null", () => {
      const generator = new EmbeddingGenerator(createMockClient(), 1536, 0);

      expect(generator.validateEmbedding(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      const generator = new EmbeddingGenerator(createMockClient(), 1536, 0);

      expect(generator.validateEmbedding(undefined)).toBe(false);
    });

    it("returns false for empty array", () => {
      const generator = new EmbeddingGenerator(createMockClient(), 1536, 0);

      expect(generator.validateEmbedding([])).toBe(false);
    });

    it("returns true for any dimension (no dimension check)", () => {
      const generator = new EmbeddingGenerator(createMockClient(), 0, 0);

      expect(generator.validateEmbedding([1, 2, 3])).toBe(true);
    });

    it("returns false for NaN values", () => {
      const generator = new EmbeddingGenerator(createMockClient(), 3, 0);

      expect(generator.validateEmbedding([1, NaN, 3])).toBe(false);
    });

    it("returns false for Infinity values", () => {
      const generator = new EmbeddingGenerator(createMockClient(), 3, 0);

      expect(generator.validateEmbedding([1, Infinity, 3])).toBe(false);
    });

    it("returns true for negative values", () => {
      const generator = new EmbeddingGenerator(createMockClient(), 3, 0);

      expect(generator.validateEmbedding([-0.5, -0.3, -0.1])).toBe(true);
    });

    it("returns false for zero vector", () => {
      const generator = new EmbeddingGenerator(createMockClient(), 0, 0);

      expect(generator.validateEmbedding([0, 0, 0])).toBe(false);
    });
  });
});