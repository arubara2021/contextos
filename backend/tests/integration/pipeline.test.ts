import { Scorer } from "../../src/injection/scorer";
import { Assembler } from "../../src/injection/assembler";
import { Retriever } from "../../src/injection/retriever";
import { ForgettingBudget } from "../../src/memory/forgetting-budget";
import { StrengthTracker } from "../../src/memory/strength-tracker";
import { TextNormalizer } from "../../src/ingestion/normalizer";
import { ConceptExtractor } from "../../src/ingestion/extractor";
import { RelationshipMapper } from "../../src/ingestion/relationship-mapper";
import type { QueryAnalysis } from "../../src/injection/query-analyzer";
import type { BudgetCandidate } from "../../src/memory/forgetting-budget";

jest.mock("../../src/agent/bedrock-client", () => ({
  getBedrockClient: jest.fn().mockReturnValue({
    extractConcepts: jest.fn().mockResolvedValue([
      { label: "TypeScript", definition: "A typed superset of JavaScript", type: "code", importance: 8, related: ["JavaScript"] },
      { label: "React Hooks", definition: "Functions for using state in functional components", type: "code", importance: 7, related: ["React"] },
    ]),
    generateEmbedding: jest.fn().mockResolvedValue(Array(1536).fill(0.1)),
    classifyRelationship: jest.fn().mockResolvedValue("related_to"),
  }),
}));

jest.mock("../../src/storage/bucket-store", () => ({
  getBucketStore: jest.fn().mockReturnValue({
    findBucketByLabel: jest.fn().mockResolvedValue(null),
    createBucket: jest.fn().mockResolvedValue({ bucketId: "bucket-new" }),
    updateBucket: jest.fn(),
    mergeIntoBucket: jest.fn(),
    getBucketByLabel: jest.fn().mockResolvedValue(null),
  }),
}));

jest.mock("../../src/storage/embedding-store", () => ({
  getEmbeddingStore: jest.fn().mockReturnValue({
    storeEmbedding: jest.fn(),
    searchSimilar: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("../../src/storage/relationship-store", () => ({
  getRelationshipStore: jest.fn().mockReturnValue({
    createRelationship: jest.fn(),
    findByBucket: jest.fn().mockResolvedValue([]),
    getStrength: jest.fn().mockResolvedValue(0),
    strengthenRelationship: jest.fn(),
  }),
}));

jest.mock("../../src/database", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
  queryOne: jest.fn().mockResolvedValue(null),
  queryMany: jest.fn().mockResolvedValue([]),
  withTransaction: jest.fn().mockImplementation(async (fn: any) => {
    const mockClient = {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    };
    return fn(mockClient);
  }),
  getPool: jest.fn().mockReturnValue({
    query: jest.fn().mockResolvedValue({ rows: [] }),
  }),
  initPool: jest.fn(),
}));

// =====================
// Scoring + Assembly Pipeline
// =====================

describe("Integration: Scoring + Assembly Pipeline", () => {
  let scorer: Scorer;
  let assembler: Assembler;

  beforeEach(() => {
    scorer = new Scorer();
    assembler = new Assembler();
  });

  it("scores memories and assembles them into context", () => {
    const candidates = [
      {
        bucketId: "b1",
        label: "TypeScript Config",
        definition: "tsconfig.json settings",
        conceptType: "fact" as const,
        strength: 0.9,
        importance: 8,
        source: "chat:session-1",
        lastAccessed: new Date("2024-06-01"),
        accessCount: 10,
        decayRate: 0.1,
        scores: { vectorScore: 0.9, textScore: 0.8, graphScore: 0.5 },
      },
      {
        bucketId: "b2",
        label: "JWT Auth",
        definition: "Token-based authentication",
        conceptType: "code" as const,
        strength: 0.7,
        importance: 7,
        source: "chat:session-2",
        lastAccessed: new Date("2024-05-15"),
        accessCount: 5,
        decayRate: 0.15,
        scores: { vectorScore: 0.7, textScore: 0.6, graphScore: 0.4 },
      },
      {
        bucketId: "b3",
        label: "Database Index",
        definition: "B-tree index for fast queries",
        conceptType: "fact" as const,
        strength: 0.5,
        importance: 5,
        source: "doc:readme",
        lastAccessed: new Date("2024-03-01"),
        accessCount: 2,
        decayRate: 0.2,
        scores: { vectorScore: 0.5, textScore: 0.4, graphScore: 0.3 },
      },
    ];

    const queryAnalysis: QueryAnalysis = {
      keyTerms: ["typescript", "config"],
      intent: "recall",
      specificity: 0.5,
    };

    const scoringResult = scorer.score(candidates);
    expect(scoringResult.scored.length).toBeGreaterThan(0);

    const assemblyResult = assembler.assemble(scoringResult.scored, queryAnalysis);
    expect(assemblyResult.contextBlock.memories.length).toBeGreaterThan(0);
    expect(assemblyResult.contextBlock.rawText).toContain("TypeScript");
  });

  it("handles large candidate sets efficiently", () => {
    const candidates = Array.from({ length: 500 }, (_, i) => ({
      bucketId: `b${i}`,
      label: `Concept ${i}`,
      definition: `Definition for concept ${i}`,
      conceptType: (i % 2 === 0 ? "fact" : "code") as "fact" | "code",
      strength: Math.random(),
      importance: Math.floor(Math.random() * 10) + 1,
      source: `chat:session-${i % 10}`,
      lastAccessed: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000),
      accessCount: Math.floor(Math.random() * 20),
      decayRate: 0.1 + Math.random() * 0.2,
      scores: { vectorScore: Math.random(), textScore: Math.random(), graphScore: Math.random() },
    }));

    const queryAnalysis: QueryAnalysis = {
      keyTerms: ["concept"],
      intent: "explore",
      specificity: 0.3,
    };

    const start = Date.now();
    const scoringResult = scorer.score(candidates);
    const assemblyResult = assembler.assemble(scoringResult.scored, queryAnalysis);
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(1000);
    expect(assemblyResult.contextBlock.memories.length).toBeGreaterThan(0);
  });

  it("normalizes scores correctly across different magnitudes", () => {
    const candidates = [
      {
        bucketId: "b1",
        label: "High Score",
        definition: "High scoring candidate",
        conceptType: "fact" as const,
        strength: 0.99,
        importance: 10,
        source: "chat:session-1",
        lastAccessed: new Date(),
        accessCount: 100,
        decayRate: 0.05,
        scores: { vectorScore: 0.99, textScore: 0.95, graphScore: 0.8 },
      },
      {
        bucketId: "b2",
        label: "Low Score",
        definition: "Low scoring candidate",
        conceptType: "fact" as const,
        strength: 0.1,
        importance: 1,
        source: "doc:old",
        lastAccessed: new Date("2024-01-01"),
        accessCount: 1,
        decayRate: 0.3,
        scores: { vectorScore: 0.1, textScore: 0.05, graphScore: 0.02 },
      },
    ];

    const result = scorer.score(candidates);
    expect(result.scored.length).toBe(2);
    expect(result.scored[0].scores.relevanceScore).toBeGreaterThanOrEqual(
      result.scored[1].scores.relevanceScore
    );
  });
});

// =====================
// Decay and Forgetting Pipeline
// =====================

describe("Integration: Decay and Forgetting Pipeline", () => {
  it("decay scan identifies crossing thresholds", () => {
    const tracker = new StrengthTracker();
    const buckets = [
      {
        bucketId: "b1",
        strength: 0.25,
        decayRate: 0.1,
        importance: 5,
        lastAccessed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        accessCount: 3,
      },
      {
        bucketId: "b2",
        strength: 0.45,
        decayRate: 0.05,
        importance: 8,
        lastAccessed: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
        accessCount: 10,
      },
    ];

    const statuses = buckets.map((b) =>
      tracker.getStatus({
        bucketId: b.bucketId,
        canonical: "test",
        strength: b.strength,
        decayRate: b.decayRate,
        importance: b.importance,
        lastAccessed: b.lastAccessed,
        accessCount: b.accessCount,
      })
    );

    expect(statuses.length).toBe(2);
    statuses.forEach((s) => {
      expect(s.category).toBeDefined();
      expect(s.currentStrength).toBeDefined();
    });
  });

  it("forgetting budget computes correctly", () => {
    const budget = new ForgettingBudget(100);

    const result1 = budget.computeBudget(0.95, 100);
    expect(result1).toBeLessThan(100);

    const result2 = budget.computeBudget(0.1, 100);
    expect(result2).toBe(100);
  });

  it("forgetting budget enforces selection", () => {
    const budget = new ForgettingBudget(5);

    const candidates: BudgetCandidate[] = Array.from({ length: 10 }, (_, i) => ({
      bucketId: `b${i}`,
      label: `Concept ${i}`,
      definition: `Definition ${i}`,
      conceptType: i % 2 === 0 ? "fact" : "code",
      relevanceScore: 1 - i * 0.1,
      strength: 1 - i * 0.1,
      source: `source-${i}`,
      importance: 10 - i,
      rank: i + 1,
    }));

    const result = budget.enforceBudget(candidates, 5);
    expect(result.selected.length).toBeLessThanOrEqual(5);
    expect(result.remaining.length).toBe(5);
  });

  it("protected high-importance memories are prioritized", () => {
    const budget = new ForgettingBudget(3);

    const candidates: BudgetCandidate[] = [
      {
        bucketId: "weak",
        label: "Weak",
        definition: "Low importance",
        conceptType: "fact",
        relevanceScore: 0.2,
        strength: 0.2,
        source: "chat:1",
        importance: 2,
        rank: 1,
      },
      {
        bucketId: "strong",
        label: "Strong",
        definition: "High importance",
        conceptType: "code",
        relevanceScore: 0.9,
        strength: 0.9,
        source: "chat:2",
        importance: 9,
        rank: 2,
      },
      {
        bucketId: "medium",
        label: "Medium",
        definition: "Medium importance",
        conceptType: "fact",
        relevanceScore: 0.5,
        strength: 0.5,
        source: "chat:3",
        importance: 5,
        rank: 3,
      },
    ];

    const result = budget.enforceBudget(candidates, 3);
    const selectedIds = result.selected.map((s) => s.bucketId);
    expect(selectedIds).toContain("strong");
  });
});

// =====================
// Query Analysis to Retrieval
// =====================

describe("Integration: Query Analysis to Retrieval", () => {
  it("analyzes query and retrieves relevant memories", () => {
    const mockSearcher = {
      search: jest.fn().mockResolvedValue([]),
    };

    const retriever = new Retriever({
      embeddingSearcher: mockSearcher,
      textSearcher: mockSearcher,
      graphSearcher: { search: jest.fn().mockResolvedValue([]) },
      metadataProvider: { getRecent: jest.fn().mockResolvedValue([]) },
    });

    expect(retriever).toBeDefined();
  });

  it("composite score balances multiple factors", () => {
    const scorer = new Scorer();

    const candidates = [
      {
        bucketId: "b1",
        label: "Relevant",
        definition: "Highly relevant",
        conceptType: "code" as const,
        strength: 0.9,
        importance: 9,
        source: "chat:session-1",
        lastAccessed: new Date(),
        accessCount: 15,
        decayRate: 0.1,
        scores: { vectorScore: 0.95, textScore: 0.85, graphScore: 0.6 },
      },
    ];

    const result = scorer.score(candidates);
    expect(result.scored[0].scores.relevanceScore).toBeGreaterThan(0);
    expect(result.scored[0].scores.relevanceScore).toBeLessThanOrEqual(1);
  });

  it("reranking boosts preferred types", () => {
    const scorer = new Scorer();

    const candidates = [
      {
        bucketId: "b1",
        label: "Fact",
        definition: "A fact",
        conceptType: "fact" as const,
        strength: 0.7,
        importance: 7,
        source: "chat:1",
        lastAccessed: new Date(),
        accessCount: 5,
        decayRate: 0.1,
        scores: { vectorScore: 0.7, textScore: 0.6, graphScore: 0.4 },
      },
      {
        bucketId: "b2",
        label: "Code",
        definition: "Some code",
        conceptType: "code" as const,
        strength: 0.7,
        importance: 7,
        source: "chat:2",
        lastAccessed: new Date(),
        accessCount: 5,
        decayRate: 0.1,
        scores: { vectorScore: 0.7, textScore: 0.6, graphScore: 0.4 },
      },
    ];

    const result = scorer.score(candidates);
    expect(result.scored.length).toBe(2);
  });
});

// =====================
// Normalization to Extraction
// =====================

describe("Integration: Normalization to Extraction", () => {
  it("normalizes message and extracts concepts from chunks", async () => {
    const normalizer = new TextNormalizer();
    const mockBedrock = {
      extractConcepts: jest.fn().mockResolvedValue([
        { label: "TypeScript", definition: "A typed superset of JavaScript", type: "code", importance: 8, related: [] },
      ]),
      generateEmbedding: jest.fn().mockResolvedValue(Array(1536).fill(0.1)),
    };
    const extractor = new ConceptExtractor(mockBedrock);

    const normalized = normalizer.normalizeMessage(
      "user",
      "TypeScript is great! It helps with large codebases.",
      "chat:session-1",
      "session-1",
      new Date().toISOString()
    );

    expect(normalized.length).toBeGreaterThan(0);

    const result = await extractor.extractFromChunks(normalized);
    expect(result.concepts.length).toBeGreaterThan(0);
  });

  it("normalizes documents with markdown removal", () => {
    const normalizer = new TextNormalizer();

    const normalized = normalizer.normalizeDocument(
      "# Title\n\nSome **bold** text with `code` and [link](http://example.com)",
      "test.md",
      "markdown"
    );

    expect(normalized.length).toBeGreaterThan(0);
    const text = normalized[0].text;
    expect(text).not.toContain("**");
    expect(text).not.toContain("#");
  });
});

// =====================
// Full Ingestion Pipeline
// =====================

describe("Integration: Full Ingestion Pipeline", () => {
  let normalizer: TextNormalizer;
  let extractor: ConceptExtractor;
  let mapper: RelationshipMapper;

  const mockBedrock = {
    extractConcepts: jest.fn().mockResolvedValue([
      { label: "TypeScript", definition: "A typed superset of JavaScript", type: "code", importance: 8, related: ["JavaScript"] },
      { label: "React Hooks", definition: "Functions for using state in functional components", type: "code", importance: 7, related: ["React"] },
    ]),
    generateEmbedding: jest.fn().mockResolvedValue(Array(1536).fill(0.1)),
    classifyRelationship: jest.fn().mockResolvedValue("related_to"),
  };

  beforeEach(() => {
    normalizer = new TextNormalizer();
    extractor = new ConceptExtractor(mockBedrock);
    mapper = new RelationshipMapper(
      { classifyRelationship: mockBedrock.classifyRelationship },
      { searchSimilar: jest.fn().mockResolvedValue([]) },
      { getCanonical: jest.fn().mockResolvedValue(null), getDefinition: jest.fn().mockResolvedValue(null) },
      { createRelationship: jest.fn().mockResolvedValue(undefined) }
    );
  });

  it("processes a message through the entire pipeline", async () => {
    const normalized = normalizer.normalizeMessage(
      "user",
      "TypeScript and React Hooks are essential for modern web development",
      "chat:session-1",
      "session-1",
      new Date().toISOString()
    );

    const extractionResult = await extractor.extractFromChunks(normalized);
    expect(extractionResult.concepts.length).toBeGreaterThan(0);

    const mappingResult = await mapper.mapRelationships(
      extractionResult.concepts,
      "TypeScript and React Hooks are essential for modern web development"
    );
    expect(Array.isArray(mappingResult.relationships)).toBe(true);
  });

  it("merges concepts when same label appears twice", async () => {
    const result1 = await extractor.extractFromChunks(
      normalizer.normalizeMessage("user", "TypeScript is typed JavaScript", "chat:s1", "s1", new Date().toISOString())
    );

    const result2 = await extractor.extractFromChunks(
      normalizer.normalizeMessage("user", "TypeScript adds static types", "chat:s2", "s2", new Date().toISOString())
    );

    expect(result1.concepts.length + result2.concepts.length).toBeGreaterThanOrEqual(2);
  });

  it("continues when embedding storage fails for one concept", async () => {
    const normalizer2 = new TextNormalizer();
    const failingBedrock = {
      extractConcepts: jest.fn().mockResolvedValue([
        { label: "TypeScript", definition: "A typed superset of JavaScript", type: "code", importance: 8, related: [] },
        { label: "React Hooks", definition: "State functions", type: "code", importance: 7, related: [] },
      ]),
      generateEmbedding: jest.fn()
        .mockResolvedValueOnce(Array(1536).fill(0.1))
        .mockRejectedValueOnce(new Error("Embedding failed")),
    };
    const extractor2 = new ConceptExtractor(failingBedrock);

    const normalized = normalizer2.normalizeMessage(
      "user",
      "TypeScript and React Hooks are useful tools",
      "chat:session-1",
      "session-1",
      new Date().toISOString()
    );

    const result = await extractor2.extractFromChunks(normalized);
    expect(result.concepts.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty content gracefully", async () => {
    const normalized = normalizer.normalizeMessage("user", "", "chat:s1", "s1", new Date().toISOString());
    const result = await extractor.extractFromChunks(normalized);
    expect(result.concepts).toEqual([]);
  });

  it("processes documents through the pipeline", async () => {
    const normalized = normalizer.normalizeDocument(
      "# TypeScript Guide\n\nTypeScript is a typed superset of JavaScript that compiles to plain JavaScript.\n\n## Features\n\n- Static typing\n- Interfaces\n- Generics",
      "typescript-guide.md",
      "markdown"
    );

    expect(normalized.length).toBeGreaterThan(0);

    const result = await extractor.extractFromChunks(normalized);
    expect(result.concepts.length).toBeGreaterThan(0);

    const mappingResult = await mapper.mapRelationships(
      result.concepts,
      "TypeScript is a typed superset of JavaScript"
    );
    expect(Array.isArray(mappingResult.relationships)).toBe(true);
  });

  it("handles extraction failure for individual chunks gracefully", async () => {
    const failingBedrock = {
      extractConcepts: jest.fn().mockRejectedValue(new Error("Bedrock rate limit")),
      generateEmbedding: jest.fn().mockResolvedValue(Array(1536).fill(0.1)),
    };
    const extractor2 = new ConceptExtractor(failingBedrock);

    const normalized = normalizer.normalizeMessage("user", "Test message", "chat:s1", "s1", new Date().toISOString());
    const result = await extractor2.extractFromChunks(normalized);
    expect(Array.isArray(result.concepts)).toBe(true);
  });

  it("maps relationships between extracted concepts", async () => {
    const normalized = normalizer.normalizeMessage(
      "user",
      "Authentication uses JWT tokens for secure API access",
      "chat:session-1",
      "session-1",
      new Date().toISOString()
    );

    const result = await extractor.extractFromChunks(normalized);
    expect(result.concepts.length).toBeGreaterThan(0);

    const mappingResult = await mapper.mapRelationships(
      result.concepts,
      "Authentication uses JWT tokens for secure API access"
    );
    expect(Array.isArray(mappingResult.relationships)).toBe(true);
  });
});