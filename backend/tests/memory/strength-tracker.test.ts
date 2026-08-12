import { StrengthTracker } from "../../src/memory/strength-tracker";
import * as database from "../../src/database";
import { computeStrength, categorize, getDecayRate } from "../../src/memory/decay";

jest.mock("../../src/database");
jest.mock("../../src/memory/decay");

const mockQuery = database.query as jest.MockedFunction<typeof database.query>;
const mockQueryMany = database.queryMany as jest.MockedFunction<typeof database.queryMany>;

const mockedComputeStrength = computeStrength as jest.MockedFunction<typeof computeStrength>;
const mockedCategorize = categorize as jest.MockedFunction<typeof categorize>;
const mockedGetDecayRate = getDecayRate as jest.MockedFunction<typeof getDecayRate>;

function createBucketRow(overrides?: Record<string, unknown>) {
  return {
    bucket_id: "bucket-1",
    canonical: "Test Concept",
    strength: 0.5,
    decay_rate: 0.15,
    importance: 7,
    last_accessed: new Date("2024-01-01"),
    access_count: 3,
    normalized: "test_concept",
    concept_type: "fact",
    created_at: new Date("2024-01-01"),
    ...overrides,
  };
}

describe("StrengthTracker", () => {
  let tracker: StrengthTracker;

  beforeEach(() => {
    tracker = new StrengthTracker();
    jest.clearAllMocks();

    mockedComputeStrength.mockImplementation(
      (initial: number, _rate: number, _days: number) => initial
    );
    mockedCategorize.mockImplementation((strength: number) => {
      if (strength >= 0.7) return "strong";
      if (strength >= 0.4) return "fading";
      if (strength >= 0.1) return "critical";
      return "forgotten";
    });
    mockedGetDecayRate.mockReturnValue(0.15);
  });

  describe("onAccess", () => {
    it("updates strength and increments access_count", async () => {
      const mockRefreshStrength = jest.fn().mockReturnValue(0.7);
      jest.spyOn(require("../../src/memory/decay"), "refreshStrength").mockReturnValue(0.7);
      mockQuery.mockResolvedValue({ rowCount: 1 } as any);

      const result = await tracker.onAccess("bucket-1", 0.5);

      expect(result).toBe(0.7);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE buckets"),
        expect.arrayContaining([0.7, "bucket-1"])
      );
    });

    it("throws on database error", async () => {
      jest.spyOn(require("../../src/memory/decay"), "refreshStrength").mockReturnValue(0.7);
      mockQuery.mockRejectedValue(new Error("Connection failed"));

      await expect(tracker.onAccess("bucket-1", 0.5)).rejects.toThrow("Connection failed");
    });
  });

  describe("getStatus", () => {
    it("returns computed current strength and category", () => {
      const mockDate = new Date("2024-01-01");
      mockedComputeStrength.mockReturnValue(0.42);

      const result = tracker.getStatus({
        bucketId: "bucket-1",
        canonical: "Test",
        strength: 0.5,
        decayRate: 0.15,
        importance: 7,
        lastAccessed: mockDate,
        accessCount: 3,
      });

      expect(result.currentStrength).toBe(0.42);
      expect(result.category).toBe("fading");
      expect(result.bucketId).toBe("bucket-1");
      expect(result.canonical).toBe("Test");
    });

    it("includes all required fields", () => {
      mockedComputeStrength.mockReturnValue(0.8);

      const result = tracker.getStatus({
        bucketId: "b1",
        canonical: "Concept",
        strength: 0.9,
        decayRate: 0.1,
        importance: 8,
        lastAccessed: new Date(),
        accessCount: 10,
      });

      expect(result).toHaveProperty("storedStrength");
      expect(result).toHaveProperty("currentStrength");
      expect(result).toHaveProperty("category");
      expect(result).toHaveProperty("decayRate");
      expect(result).toHaveProperty("importance");
      expect(result).toHaveProperty("daysSinceAccess");
    });
  });

  describe("getStatusById", () => {
    it("returns null when bucket not found", async () => {
      mockQueryMany.mockResolvedValue([]);

      const result = await tracker.getStatusById("nonexistent");

      expect(result).toBeNull();
    });

    it("returns status when bucket found", async () => {
      mockQueryMany.mockResolvedValue([createBucketRow()]);
      mockedComputeStrength.mockReturnValue(0.42);

      const result = await tracker.getStatusById("bucket-1");

      expect(result).not.toBeNull();
      expect(result!.bucketId).toBe("bucket-1");
      expect(result!.currentStrength).toBe(0.42);
    });

    it("throws on database error", async () => {
      mockQueryMany.mockRejectedValue(new Error("Query failed"));

      await expect(tracker.getStatusById("bucket-1")).rejects.toThrow("Query failed");
    });
  });

  describe("bulkStatus", () => {
    it("returns all statuses with summary", async () => {
      mockQueryMany.mockResolvedValue([
        createBucketRow({ bucket_id: "b1", strength: 0.9 }),
        createBucketRow({ bucket_id: "b2", strength: 0.5 }),
        createBucketRow({ bucket_id: "b3", strength: 0.2 }),
        createBucketRow({ bucket_id: "b4", strength: 0.05 }),
      ]);
      mockedComputeStrength.mockImplementation((initial) => initial);

      const result = await tracker.bulkStatus();

      expect(result.statuses).toHaveLength(4);
      expect(result.summary.total).toBe(4);
      expect(result.summary.averageStrength).toBeGreaterThan(0);
    });

    it("returns zero counts for empty database", async () => {
      mockQueryMany.mockResolvedValue([]);

      const result = await tracker.bulkStatus();

      expect(result.statuses).toHaveLength(0);
      expect(result.summary.total).toBe(0);
      expect(result.summary.averageStrength).toBe(0);
    });
  });

  describe("getStrengthDistribution", () => {
    it("returns ranges with counts", async () => {
      mockQueryMany.mockResolvedValue([
        createBucketRow({ bucket_id: "b1", strength: 0.95 }),
        createBucketRow({ bucket_id: "b2", strength: 0.8 }),
        createBucketRow({ bucket_id: "b3", strength: 0.5 }),
        createBucketRow({ bucket_id: "b4", strength: 0.2 }),
        createBucketRow({ bucket_id: "b5", strength: 0.05 }),
      ]);
      mockedComputeStrength.mockImplementation((initial) => initial);

      const result = await tracker.getStrengthDistribution();

      expect(result.ranges).toBeDefined();
      expect(result.ranges.length).toBe(5);
      expect(result.total).toBe(5);
    });

    it("returns zero counts for empty database", async () => {
      mockQueryMany.mockResolvedValue([]);

      const result = await tracker.getStrengthDistribution();

      expect(result.total).toBe(0);
      result.ranges.forEach((range) => {
        expect(range.count).toBe(0);
      });
    });
  });

  describe("getMemoriesByCategory", () => {
    it("categorizes memories into correct buckets", async () => {
      mockQueryMany.mockResolvedValue([
        createBucketRow({ bucket_id: "b1", strength: 0.9 }),
        createBucketRow({ bucket_id: "b2", strength: 0.5 }),
        createBucketRow({ bucket_id: "b3", strength: 0.2 }),
        createBucketRow({ bucket_id: "b4", strength: 0.05 }),
      ]);
      mockedComputeStrength.mockImplementation((initial) => initial);

      const result = await tracker.getMemoriesByCategory();

      expect(result.strong).toHaveLength(1);
      expect(result.fading).toHaveLength(1);
      expect(result.critical).toHaveLength(1);
      expect(result.forgotten).toHaveLength(1);
    });
  });

  describe("applyStrengthUpdate", () => {
    it("updates strength with clamping", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 } as any);

      await tracker.applyStrengthUpdate("bucket-1", 0.95);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE buckets"),
        [0.95, "bucket-1"]
      );
    });

    it("clamps values above 1.0", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 } as any);

      await tracker.applyStrengthUpdate("bucket-1", 1.5);

      expect(mockQuery).toHaveBeenCalledWith(expect.anything(), [1, "bucket-1"]);
    });

    it("clamps values below 0.0", async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 } as any);

      await tracker.applyStrengthUpdate("bucket-1", -0.5);

      expect(mockQuery).toHaveBeenCalledWith(expect.anything(), [0, "bucket-1"]);
    });
  });
});
