import { BucketStore, normalizeKey } from "../../src/storage/bucket-store";
import * as database from "../../src/database";

jest.mock("../../src/database");

const mockQuery = database.query as jest.MockedFunction<typeof database.query>;
const mockQueryOne = database.queryOne as jest.MockedFunction<typeof database.queryOne>;
const mockQueryMany = database.queryMany as jest.MockedFunction<typeof database.queryMany>;
const mockWithTransaction = database.withTransaction as jest.MockedFunction<typeof database.withTransaction>;

describe("normalizeKey", () => {
  it("normalizes simple labels", () => {
    expect(normalizeKey("TypeScript")).toBe("typescript");
  });

  it("sorts words alphabetically", () => {
    expect(normalizeKey("Machine Learning")).toBe("learning_machine");
  });

  it("removes special characters", () => {
    expect(normalizeKey("React.js Framework")).toBe("reactjs");
  });

  it("strips common suffixes", () => {
    expect(normalizeKey("Authentication System")).toBe("authentication");
    expect(normalizeKey("Caching Module")).toBe("caching");
    expect(normalizeKey("Rate Limiting Approach")).toBe("limiting_rate");
  });

  it("strips common prefixes", () => {
    expect(normalizeKey("The Database")).toBe("database_the");
    expect(normalizeKey("A Framework")).toBe("a");
  });

  it("handles empty string", () => {
    expect(normalizeKey("")).toBe("");
  });

  it("handles whitespace-only string", () => {
    expect(normalizeKey("   ")).toBe("");
  });

  it("produces consistent keys for same concept", () => {
    const key1 = normalizeKey("User Authentication");
    const key2 = normalizeKey("authentication user");
    expect(key1).toBe(key2);
  });

  it("handles single word", () => {
    expect(normalizeKey("Docker")).toBe("docker");
  });

  it("handles multiple spaces", () => {
    expect(normalizeKey("too   many    spaces")).toBe("many_spaces_too");
  });
});

describe("BucketStore", () => {
  let bucketStore: BucketStore;

  beforeEach(() => {
    bucketStore = new BucketStore();
    jest.clearAllMocks();
  });

  describe("findByNormalized", () => {
    it("returns bucket_id when found", async () => {
      mockQueryOne.mockResolvedValue({ bucket_id: "bucket-123" });

      const result = await bucketStore.findByNormalized("test_concept");

      expect(result).toBe("bucket-123");
      expect(mockQueryOne).toHaveBeenCalledWith(
        "SELECT bucket_id FROM buckets WHERE normalized = $1 LIMIT 1",
        ["test_concept"]
      );
    });

    it("returns null when not found", async () => {
      mockQueryOne.mockResolvedValue(null);

      const result = await bucketStore.findByNormalized("nonexistent");

      expect(result).toBeNull();
    });

    it("throws on database error", async () => {
      mockQueryOne.mockRejectedValue(new Error("Connection failed"));

      await expect(bucketStore.findByNormalized("test")).rejects.toThrow("Connection failed");
    });
  });

  describe("createBucket", () => {
    it("creates bucket with correct parameters", async () => {
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ bucket_id: "new-bucket-1" }] })
          .mockResolvedValueOnce({ rows: [] }),
        release: jest.fn(),
      };

      mockWithTransaction.mockImplementation(async (fn) => fn(mockClient as any));

      const result = await bucketStore.createBucket({
        canonical: "Test Concept",
        normalized: "concept_test",
        importance: 7,
        conceptType: "fact",
        decayRate: 0.15,
        itemLabel: "Test Concept",
        itemDefinition: "A test concept",
        itemSource: "test",
      });

      expect(result).toBe("new-bucket-1");
      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });
  });

  describe("mergeIntoBucket", () => {
    it("inserts new item and updates bucket", async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };

      mockWithTransaction.mockImplementation(async (fn) => fn(mockClient as any));

      await bucketStore.mergeIntoBucket("bucket-1", "New Label", "New definition", "test", 8);

      expect(mockClient.query).toHaveBeenCalledTimes(2);
    });

    it("updates access count and last_accessed", async () => {
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };

      mockWithTransaction.mockImplementation(async (fn) => fn(mockClient as any));

      await bucketStore.mergeIntoBucket("bucket-1", "Label");

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("access_count = access_count + 1"),
        expect.anything()
      );
    });
  });

  describe("getOrCreateBucket", () => {
    it("returns existing bucket when found", async () => {
      mockQueryOne.mockResolvedValue({ bucket_id: "existing-1" });
      const mockClient = {
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(mockClient as any));

      const result = await bucketStore.getOrCreateBucket("Test", "definition", "fact", 5, "test");

      expect(result.bucketId).toBe("existing-1");
      expect(result.isNew).toBe(false);
    });

    it("creates new bucket when not found", async () => {
      mockQueryOne.mockResolvedValue(null);
      const mockClient = {
        query: jest.fn()
          .mockResolvedValueOnce({ rows: [{ bucket_id: "new-bucket" }] })
          .mockResolvedValueOnce({ rows: [] }),
        release: jest.fn(),
      };
      mockWithTransaction.mockImplementation(async (fn) => fn(mockClient as any));

      const result = await bucketStore.getOrCreateBucket("New Concept", "definition", "fact", 5, "test");

      expect(result.bucketId).toBe("new-bucket");
      expect(result.isNew).toBe(true);
    });
  });

  describe("getAllBuckets", () => {
    it("returns mapped bucket objects", async () => {
      mockQueryMany.mockResolvedValue([
        {
          bucket_id: "b1",
          canonical: "Concept A",
          normalized: "concept_a",
          strength: 0.8,
          importance: 7,
          concept_type: "fact",
          last_accessed: new Date("2024-01-01"),
          access_count: 5,
          decay_rate: 0.15,
          created_at: new Date("2024-01-01"),
        },
      ]);

      const result = await bucketStore.getAllBuckets();

      expect(result).toHaveLength(1);
      expect(result[0].bucketId).toBe("b1");
      expect(result[0].canonical).toBe("Concept A");
      expect(result[0].strength).toBe(0.8);
    });

    it("applies concept type filter", async () => {
      mockQueryMany.mockResolvedValue([]);

      await bucketStore.getAllBuckets({ conceptType: "code" });

      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.stringContaining("concept_type = $1"),
        expect.arrayContaining(["code"])
      );
    });

    it("applies search filter", async () => {
      mockQueryMany.mockResolvedValue([]);

      await bucketStore.getAllBuckets({ search: "typescript" });

      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.stringContaining("ILIKE"),
        expect.arrayContaining(["%typescript%"])
      );
    });

    it("applies limit and offset", async () => {
      mockQueryMany.mockResolvedValue([]);

      await bucketStore.getAllBuckets({ limit: 10, offset: 20 });

      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.stringContaining("LIMIT"),
        expect.arrayContaining([10, 20])
      );
    });
  });

  describe("getBucketById", () => {
    it("returns bucket with items when found", async () => {
      mockQueryOne.mockResolvedValue({
        bucket_id: "b1",
        canonical: "Test",
        normalized: "test",
        strength: 0.5,
        importance: 5,
        concept_type: "fact",
        last_accessed: new Date(),
        access_count: 1,
        decay_rate: 0.15,
        created_at: new Date(),
      });

      mockQueryMany.mockResolvedValue([
        {
          item_id: "i1",
          bucket_id: "b1",
          label: "Test",
          definition: "A test",
          source: "test",
          timestamp: new Date(),
        },
      ]);

      const result = await bucketStore.getBucketById("b1");

      expect(result).not.toBeNull();
      expect(result!.bucket.bucketId).toBe("b1");
      expect(result!.items).toHaveLength(1);
    });

    it("returns null when not found", async () => {
      mockQueryOne.mockResolvedValue(null);

      const result = await bucketStore.getBucketById("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("updateAccess", () => {
    it("updates strength and increments access count", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);

      await bucketStore.updateAccess("bucket-1", 0.9);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("strength = $1"),
        [0.9, "bucket-1"]
      );
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("access_count = access_count + 1"),
        expect.anything()
      );
    });
  });

  describe("updateBucket", () => {
    it("updates specified fields", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);

      await bucketStore.updateBucket("bucket-1", { canonical: "New Name", importance: 9 });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("canonical = $1"),
        expect.arrayContaining(["New Name", 9, "bucket-1"])
      );
    });

    it("does nothing when no updates provided", async () => {
      await bucketStore.updateBucket("bucket-1", {});

      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("deleteBucket", () => {
    it("deletes bucket by id", async () => {
      mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any);

      await bucketStore.deleteBucket("bucket-1");

      expect(mockQuery).toHaveBeenCalledWith(
        "DELETE FROM buckets WHERE bucket_id = $1",
        ["bucket-1"]
      );
    });
  });

  describe("countByCategory", () => {
    it("returns counts for each strength category", async () => {
      mockQueryOne
        .mockResolvedValueOnce({ count: 10 })
        .mockResolvedValueOnce({ count: 5 })
        .mockResolvedValueOnce({ count: 3 })
        .mockResolvedValueOnce({ count: 2 });

      const result = await bucketStore.countByCategory();

      expect(result.strong).toBe(10);
      expect(result.fading).toBe(5);
      expect(result.critical).toBe(3);
      expect(result.forgotten).toBe(2);
    });
  });

  describe("countByType", () => {
    it("returns count grouped by concept type", async () => {
      mockQueryMany.mockResolvedValue([
        { concept_type: "fact", count: 15 },
        { concept_type: "code", count: 8 },
        { concept_type: "decision", count: 5 },
      ]);

      const result = await bucketStore.countByType();

      expect(result.fact).toBe(15);
      expect(result.code).toBe(8);
      expect(result.decision).toBe(5);
    });
  });

  describe("getTotalCount", () => {
    it("returns total bucket count", async () => {
      mockQueryOne.mockResolvedValue({ count: 42 });

      const result = await bucketStore.getTotalCount();

      expect(result).toBe(42);
    });

    it("returns 0 when no buckets exist", async () => {
      mockQueryOne.mockResolvedValue(null);

      const result = await bucketStore.getTotalCount();

      expect(result).toBe(0);
    });
  });

  describe("searchBuckets", () => {
    it("searches by canonical and items", async () => {
      mockQueryMany.mockResolvedValue([]);

      await bucketStore.searchBuckets("typescript", 10);

      expect(mockQueryMany).toHaveBeenCalledWith(
        expect.stringContaining("ILIKE"),
        expect.arrayContaining(["%typescript%", 10])
      );
    });
  });
});