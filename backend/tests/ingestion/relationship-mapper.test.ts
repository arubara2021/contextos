import { RelationshipMapper } from "../../src/ingestion/relationship-mapper";
import type { Concept } from "../../src/models/concept.model";

function createConcept(overrides?: Partial<Concept>): Concept {
  return {
    bucketId: "bucket-" + Math.random().toString(36).substring(7),
    label: "TypeScript",
    definition: "A typed superset of JavaScript",
    conceptType: "code",
    importance: 8,
    source: "test",
    relatedTerms: [],
    embedding: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockClassifier() {
  return {
    classifyRelationship: jest.fn().mockResolvedValue("related_to"),
  };
}

function createMockSearcher() {
  return {
    searchSimilar: jest.fn().mockResolvedValue([]),
  };
}

function createMockBucketLookup() {
  return {
    getCanonical: jest.fn().mockResolvedValue(null),
    getDefinition: jest.fn().mockResolvedValue(null),
  };
}

function createMockStore() {
  return {
    createRelationship: jest.fn().mockResolvedValue(undefined),
  };
}

describe("RelationshipMapper", () => {
  let classifier: ReturnType<typeof createMockClassifier>;
  let searcher: ReturnType<typeof createMockSearcher>;
  let bucketLookup: ReturnType<typeof createMockBucketLookup>;
  let store: ReturnType<typeof createMockStore>;
  let mapper: RelationshipMapper;

  beforeEach(() => {
    classifier = createMockClassifier();
    searcher = createMockSearcher();
    bucketLookup = createMockBucketLookup();
    store = createMockStore();
    mapper = new RelationshipMapper(classifier, searcher, bucketLookup, store, 0, 0);
  });

  describe("mapRelationships", () => {
    it("returns empty result for single concept", async () => {
      const concepts = [createConcept()];
      const result = await mapper.mapRelationships(concepts, "some source text");

      expect(result.relationships).toEqual([]);
      expect(result.withinChunkCount).toBe(0);
      expect(result.crossChunkCount).toBe(0);
      expect(result.mappingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("returns empty result for empty concepts", async () => {
      const result = await mapper.mapRelationships([], "some text");

      expect(result.relationships).toEqual([]);
    });

    it("detects relationships between co-occurring concepts", async () => {
      const concepts = [
        createConcept({ label: "TypeScript", conceptType: "code" }),
        createConcept({ label: "JavaScript", conceptType: "code" }),
      ];

      const result = await mapper.mapRelationships(
        concepts,
        "TypeScript is a typed superset of JavaScript that adds static types."
      );

      expect(classifier.classifyRelationship).toHaveBeenCalled();
      expect(result.withinChunkCount).toBeGreaterThanOrEqual(1);
    });

    it("detects causal relationships", async () => {
      classifier.classifyRelationship.mockResolvedValue("causes");

      const concepts = [
        createConcept({ label: "Memory Leak", conceptType: "problem" }),
        createConcept({ label: "Connection Pool", conceptType: "entity" }),
      ];

      const result = await mapper.mapRelationships(
        concepts,
        "Memory Leak causes Connection Pool exhaustion in production."
      );

      expect(result.relationships.length).toBeGreaterThanOrEqual(1);
      const causal = result.relationships.find((r) => r.relationType === "causes");
      expect(causal).toBeDefined();
      expect(causal!.confidence).toBeGreaterThan(0);
    });

    it("detects dependency relationships", async () => {
      classifier.classifyRelationship.mockResolvedValue("causes");

      const concepts = [
        createConcept({ label: "API Server", conceptType: "entity" }),
        createConcept({ label: "Database", conceptType: "entity" }),
      ];

      const result = await mapper.mapRelationships(
        concepts,
        "API Server depends on Database for all data persistence."
      );

      expect(result.relationships.length).toBeGreaterThanOrEqual(1);
      const dep = result.relationships.find((r) => r.relationType === "causes");
      expect(dep).toBeDefined();
    });

    it("detects extension relationships", async () => {
      classifier.classifyRelationship.mockResolvedValue("related_to");

      const concepts = [
        createConcept({ label: "TypeScript", conceptType: "code" }),
        createConcept({ label: "JavaScript", conceptType: "code" }),
      ];

      const result = await mapper.mapRelationships(
        concepts,
        "TypeScript extends JavaScript with static type checking and interfaces."
      );

      expect(result.relationships.length).toBeGreaterThanOrEqual(1);
      expect(result.relationships[0].relationType).toBe("related_to");
    });

    it("stores relationships in the store", async () => {
      const concepts = [
        createConcept({ label: "React", conceptType: "code" }),
        createConcept({ label: "Component", conceptType: "entity" }),
      ];

      await mapper.mapRelationships(
        concepts,
        "React Component lifecycle includes mounting and unmounting phases."
      );

      expect(store.createRelationship).toHaveBeenCalled();
    });

    it("includes source text in relationships", async () => {
      const concepts = [
        createConcept({ label: "React", conceptType: "code" }),
        createConcept({ label: "Component", conceptType: "entity" }),
      ];
      const sourceText = "React Component lifecycle includes mounting and unmounting phases.";

      const result = await mapper.mapRelationships(concepts, sourceText);

      result.relationships.forEach((r) => {
        expect(r.sourceText).toBeDefined();
        expect(typeof r.sourceText).toBe("string");
      });
    });

    it("assigns confidence between 0 and 1", async () => {
      const concepts = [
        createConcept({ label: "A", conceptType: "fact" }),
        createConcept({ label: "B", conceptType: "code" }),
      ];

      const result = await mapper.mapRelationships(
        concepts,
        "A is important for B in this context."
      );

      result.relationships.forEach((r) => {
        expect(r.confidence).toBeGreaterThanOrEqual(0);
        expect(r.confidence).toBeLessThanOrEqual(1);
      });
    });

    it("returns timing information", async () => {
      const concepts = [
        createConcept({ label: "A" }),
        createConcept({ label: "B" }),
      ];

      const result = await mapper.mapRelationships(concepts, "A and B are related.");

      expect(result.mappingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("handles empty source text", async () => {
      const concepts = [
        createConcept({ label: "A" }),
        createConcept({ label: "B" }),
      ];

      const result = await mapper.mapRelationships(concepts, "");

      expect(result.relationships).toBeDefined();
      expect(result.mappingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it("handles many concepts efficiently", async () => {
      const concepts = Array.from({ length: 20 }, (_, i) =>
        createConcept({
          label: `Concept${i}`,
          conceptType: i % 2 === 0 ? "fact" : "code",
        })
      );

      const result = await mapper.mapRelationships(
        concepts,
        concepts.map((c) => c.label).join(" is related to ") + "."
      );

      expect(result.mappingTimeMs).toBeLessThan(5000);
    });

    it("finds cross-chunk relationships via similarity search", async () => {
      const concept = createConcept({ label: "TypeScript", embedding: [0.1, 0.2, 0.3] });

      searcher.searchSimilar.mockResolvedValue([
        { bucketId: "other-bucket", similarity: 0.85 },
      ]);
      bucketLookup.getCanonical.mockResolvedValue("JavaScript");
      bucketLookup.getDefinition.mockResolvedValue("A programming language");

      const result = await mapper.mapRelationships(
        [concept, createConcept({ label: "JavaScript" })],
        "TypeScript and JavaScript are related."
      );

      expect(searcher.searchSimilar).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it("skips self-references in cross-chunk", async () => {
      const concept = createConcept({ label: "TypeScript", embedding: [0.1, 0.2] });

      searcher.searchSimilar.mockResolvedValue([
        { bucketId: "ts-bucket", similarity: 0.9 },
      ]);
      bucketLookup.getCanonical.mockResolvedValue("TypeScript");

      const result = await mapper.mapRelationships(
        [concept, createConcept({ label: "JavaScript" })],
        "TypeScript stuff."
      );

      expect(result.crossChunkCount).toBe(0);
    });
  });
});