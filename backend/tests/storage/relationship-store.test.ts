import { RelationshipStore } from "../../src/storage/relationship-store";
import * as database from "../../src/database";

jest.mock("../../src/database");

const mockQuery = database.query as jest.MockedFunction<typeof database.query>;
const mockQueryOne = database.queryOne as jest.MockedFunction<typeof database.queryOne>;
const mockQueryMany = database.queryMany as jest.MockedFunction<typeof database.queryMany>;
const mockWithTransaction = database.withTransaction as jest.MockedFunction<typeof database.withTransaction>;

function createRelationshipRow(overrides?: Record<string, unknown>) {
  return {
    relationship_id: "rel-1",
    source_bucket: "concept_a",
    target_bucket: "concept_b",
    relation_type: "related_to",
    confidence: 0.85,
    source_text: "A is related to B",
    created_at: new Date("2024-01-01"),
    ...overrides,
  };
}

function createMetaRow(overrides?: Record<string, unknown>) {
  return {
    ...createRelationshipRow(overrides),
    connected_bucket_name: "Concept B",
    connected_bucket_type: "fact",
    ...overrides,
  };
}

describe("RelationshipStore", () => {
  let store: RelationshipStore;

  beforeEach(() => {
    store = new RelationshipStore();
    jest.clearAllMocks();
  });

  describe("createRelationship", () => {
    it("creates a new relationship and returns its id", async () => {
      mockQueryOne.mockResolvedValue({ relationship_id: "rel-new" });
      const result = await store.createRelationship({
        sourceBucket: "TypeScript", targetBucket: "JavaScript",
        relationType: "related_to", confidence: 0.9,
        sourceText: "TypeScript extends JavaScript",
      });
      expect(result).toBe("rel-new");
    });

    it("defaults confidence to 0.5 when not provided", async () => {
      mockQueryOne.mockResolvedValue({ relationship_id: "rel-new" });
      await store.createRelationship({ sourceBucket: "A", targetBucket: "B", relationType: "related_to" });
      expect(mockQueryOne).toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([0.5]));
    });

    it("upserts on duplicate instead of throwing", async () => {
      mockQueryOne.mockResolvedValue({ relationship_id: "rel-existing" });
      const result = await store.createRelationship({ sourceBucket: "A", targetBucket: "B", relationType: "related_to", confidence: 0.7 });
      expect(result).toBe("rel-existing");
      expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining("ON CONFLICT"), expect.any(Array));
    });

    it("throws on database connection error", async () => {
      mockQueryOne.mockRejectedValue(new Error("Connection refused"));
      await expect(store.createRelationship({ sourceBucket: "A", targetBucket: "B", relationType: "related_to" })).rejects.toThrow("Connection refused");
    });

    it("stores all provided fields", async () => {
      mockQueryOne.mockResolvedValue({ relationship_id: "rel-1" });
      await store.createRelationship({ sourceBucket: "Source", targetBucket: "Target", relationType: "related_to", confidence: 0.75, sourceText: "Source causes Target" });
      expect(mockQueryOne).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO relationships"), ["Source", "Target", "related_to", 0.75, "Source causes Target"]);
    });
  });

  describe("getRelationshipsFrom", () => {
    it("returns outgoing relationships", async () => {
      mockQueryMany.mockResolvedValue([createMetaRow({ source_bucket: "A", target_bucket: "B" })]);
      const results = await store.getRelationshipsFrom("A");
      expect(results).toHaveLength(1);
    });

    it("returns empty array when no outgoing relationships", async () => {
      mockQueryMany.mockResolvedValue([]);
      const results = await store.getRelationshipsFrom("lonely");
      expect(results).toEqual([]);
    });

    it("throws on database error", async () => {
      mockQueryMany.mockRejectedValue(new Error("Query timeout"));
      await expect(store.getRelationshipsFrom("A")).rejects.toThrow("Query timeout");
    });
  });

  describe("getRelationshipsTo", () => {
    it("returns incoming relationships", async () => {
      mockQueryMany.mockResolvedValue([createMetaRow({ source_bucket: "X", target_bucket: "A" })]);
      const results = await store.getRelationshipsTo("A");
      expect(results).toHaveLength(1);
    });

    it("returns empty array when no incoming relationships", async () => {
      mockQueryMany.mockResolvedValue([]);
      const results = await store.getRelationshipsTo("orphan");
      expect(results).toEqual([]);
    });
  });

  describe("getAllConnected", () => {
    it("combines outgoing and incoming relationships", async () => {
      mockQueryMany
        .mockResolvedValueOnce([createMetaRow({ relationship_id: "rel-out", source_bucket: "A", target_bucket: "B" })])
        .mockResolvedValueOnce([createMetaRow({ relationship_id: "rel-in", source_bucket: "C", target_bucket: "A" })]);
      const results = await store.getAllConnected("A");
      expect(results).toHaveLength(2);
    });

    it("returns empty array when bucket has no relationships", async () => {
      mockQueryMany.mockResolvedValue([]);
      const results = await store.getAllConnected("lonely");
      expect(results).toEqual([]);
    });

    it("deduplicates relationships found in both directions", async () => {
      const row = createMetaRow();
      mockQueryMany.mockResolvedValueOnce([row]).mockResolvedValueOnce([row]);
      const results = await store.getAllConnected("concept_a");
      const ids = results.map((r) => r.relationshipId);
      expect(ids.length).toBe([...new Set(ids)].length);
    });
  });

  describe("getByType", () => {
    it("returns relationships of specific type", async () => {
      mockQueryMany.mockResolvedValue([createRelationshipRow({ relation_type: "causes" })]);
      const results = await store.getByType("causes");
      expect(results).toHaveLength(1);
      expect(results[0].relationType).toBe("causes");
    });

    it("returns empty array for unused relation type", async () => {
      mockQueryMany.mockResolvedValue([]);
      const results = await store.getByType("nonexistent_type");
      expect(results).toEqual([]);
    });
  });

  describe("deleteRelationship", () => {
    it("deletes a relationship by id", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 } as any);
      await store.deleteRelationship("rel-1");
      expect(mockQuery).toHaveBeenCalledWith("DELETE FROM relationships WHERE relationship_id = $1", ["rel-1"]);
    });
  });

  describe("deleteByBucket", () => {
    it("deletes all relationships involving a bucket", async () => {
      mockQuery.mockResolvedValue({ rowCount: 3 } as any);
      const deleted = await store.deleteByBucket("bucket-1");
      expect(deleted).toBe(3);
    });

    it("returns 0 when bucket has no relationships", async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 } as any);
      const deleted = await store.deleteByBucket("lonely");
      expect(deleted).toBe(0);
    });
  });

  describe("batchCreate", () => {
    it("creates multiple relationships in a transaction", async () => {
      const mockClient = { query: jest.fn().mockResolvedValue({ rows: [{ relationship_id: "rel-new" }] }), release: jest.fn() };
      mockWithTransaction.mockImplementation(async (fn) => fn(mockClient as any));
      const created = await store.batchCreate([
        { sourceBucket: "A", targetBucket: "B", relationType: "related_to", confidence: 0.8 },
        { sourceBucket: "B", targetBucket: "C", relationType: "related_to", confidence: 0.6 },
        { sourceBucket: "A", targetBucket: "C", relationType: "related_to", confidence: 0.9 },
      ]);
      expect(created).toBe(3);
      expect(mockClient.query).toHaveBeenCalledTimes(3);
    });

    it("returns 0 for empty array", async () => {
      const created = await store.batchCreate([]);
      expect(created).toBe(0);
      expect(mockWithTransaction).not.toHaveBeenCalled();
    });

    it("handles duplicate entries gracefully", async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ relationship_id: "rel-1" }] })
          .mockRejectedValueOnce({ code: "23505", message: "duplicate key" })
          .mockResolvedValueOnce({ rows: [{ relationship_id: "rel-3" }] }),
        release: jest.fn(),
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(mockClient as any));
      const created = await store.batchCreate([
        { sourceBucket: "A", targetBucket: "B", relationType: "related_to", confidence: 0.8 },
        { sourceBucket: "A", targetBucket: "B", relationType: "related_to", confidence: 0.5 },
        { sourceBucket: "C", targetBucket: "D", relationType: "related_to", confidence: 0.7 },
      ]);
      expect(created).toBe(2);
    });
  });

  describe("getTotalCount", () => {
    it("returns total relationship count", async () => {
      mockQueryOne.mockResolvedValue({ count: 42 });
      expect(await store.getTotalCount()).toBe(42);
    });

    it("returns 0 when no relationships exist", async () => {
      mockQueryOne.mockResolvedValue(null);
      expect(await store.getTotalCount()).toBe(0);
    });
  });

  describe("getCountByType", () => {
    it("returns count grouped by relation type", async () => {
      mockQueryMany.mockResolvedValue([
        { relation_type: "related_to", count: 10 },
        { relation_type: "causes", count: 5 },
      ]);
      const result = await store.getCountByType();
      expect(result.related_to).toBe(10);
      expect(result.causes).toBe(5);
    });
  });

  describe("getAll", () => {
    it("returns all relationships", async () => {
      mockQueryMany.mockResolvedValue([createRelationshipRow({ relationship_id: "rel-1" }), createRelationshipRow({ relationship_id: "rel-2" })]);
      const results = await store.getAll();
      expect(results).toHaveLength(2);
    });
  });

  describe("strengthenCoAccess", () => {
    it("returns 0 for single bucket", async () => {
      expect(await store.strengthenCoAccess(["bucket-1"])).toBe(0);
    });

    it("strengthens confidence for co-accessed pairs", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 } as any);
      const result = await store.strengthenCoAccess(["b1", "b2"]);
      expect(result).toBeGreaterThan(0);
    });
  });

  describe("cleanupOrphaned", () => {
    it("deletes orphaned relationships", async () => {
      mockQuery.mockResolvedValue({ rowCount: 5 } as any);
      expect(await store.cleanupOrphaned()).toBe(5);
    });
  });
});
