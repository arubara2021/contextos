import request from "supertest";
import express from "express";
import memoriesRouter from "../../src/api/memories.routes";

jest.mock("../../src/api/dependencies", () => ({
  getDependencies: jest.fn(),
}));

jest.mock("../../src/auth/middleware", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    if (!req.headers.authorization) {
      return res.status(401).json({ error: "No token provided" });
    }
    req.userId = "user-123";
    next();
  },
}));

jest.mock("../../src/models/concept.model", () => ({
  isConceptType: (type: string) =>
    ["problem", "decision", "fact", "entity", "event", "preference", "code"].includes(type),
}));

const { getDependencies } = require("../../src/api/dependencies");

const mockBucketStore = {
  getAllBuckets: jest.fn(),
  getTotalCount: jest.fn(),
  getBucketById: jest.fn(),
  updateBucket: jest.fn(),
  deleteBucket: jest.fn(),
  countByCategory: jest.fn(),
  countByType: jest.fn(),
};

const mockStrengthTracker = {
  getStatus: jest.fn(),
  bulkStatus: jest.fn(),
  getDecayCurveForBucket: jest.fn(),
};

const mockRelationshipStore = {
  getAllConnected: jest.fn(),
  getTotalCount: jest.fn(),
  deleteByBucket: jest.fn(),
};

const mockEmbeddingStore = {
  deleteEmbedding: jest.fn(),
};

const mockRawStore = {
  getTotalMessages: jest.fn(),
  getTotalSessions: jest.fn(),
};

const BUCKET_1 = {
  bucketId: "bucket-1",
  canonical: "TypeScript",
  strength: 0.9,
  decayRate: 0.1,
  importance: 8,
  conceptType: "code",
  lastAccessed: new Date("2024-06-01"),
  accessCount: 10,
  createdAt: new Date("2024-01-01"),
};

const BUCKET_2 = {
  bucketId: "bucket-2",
  canonical: "React Hooks",
  strength: 0.7,
  decayRate: 0.15,
  importance: 6,
  conceptType: "code",
  lastAccessed: new Date("2024-05-15"),
  accessCount: 5,
  createdAt: new Date("2024-02-01"),
};

const ITEM_1 = {
  itemId: "item-1",
  label: "TypeScript",
  definition: "A typed superset of JavaScript",
  source: "chat:session-1",
  timestamp: new Date("2024-06-01"),
};

const app = express();
app.use(express.json());
app.use("/api/memories", memoriesRouter);

const AUTH_TOKEN = "valid-test-token";

beforeEach(() => {
  jest.clearAllMocks();
  getDependencies.mockReturnValue({
    bucketStore: mockBucketStore,
    strengthTracker: mockStrengthTracker,
    relationshipStore: mockRelationshipStore,
    embeddingStore: mockEmbeddingStore,
    rawStore: mockRawStore,
  });
  mockStrengthTracker.getStatus.mockReturnValue({
    currentStrength: 0.8,
    category: "strong",
    daysSinceAccess: 2,
  });
});

describe("GET /api/memories", () => {
  it("returns all memories", async () => {
    mockBucketStore.getAllBuckets.mockResolvedValue([BUCKET_1, BUCKET_2]);
    mockBucketStore.getTotalCount.mockResolvedValue(2);

    const res = await request(app)
      .get("/api/memories")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.memories).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.memories[0].canonical).toBe("TypeScript");
  });

  it("returns empty array when no memories", async () => {
    mockBucketStore.getAllBuckets.mockResolvedValue([]);
    mockBucketStore.getTotalCount.mockResolvedValue(0);

    const res = await request(app)
      .get("/api/memories")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.memories).toEqual([]);
    expect(res.body.total).toBe(0);
  });

  it("supports concept type filter", async () => {
    mockBucketStore.getAllBuckets.mockResolvedValue([BUCKET_1]);
    mockBucketStore.getTotalCount.mockResolvedValue(1);

    await request(app)
      .get("/api/memories?type=code")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(mockBucketStore.getAllBuckets).toHaveBeenCalledWith(
      expect.objectContaining({ conceptType: "code" })
    );
  });

  it("supports search filter", async () => {
    mockBucketStore.getAllBuckets.mockResolvedValue([BUCKET_1]);
    mockBucketStore.getTotalCount.mockResolvedValue(1);

    await request(app)
      .get("/api/memories?search=typescript")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(mockBucketStore.getAllBuckets).toHaveBeenCalledWith(
      expect.objectContaining({ search: "typescript" })
    );
  });

  it("supports limit and offset pagination", async () => {
    mockBucketStore.getAllBuckets.mockResolvedValue([]);
    mockBucketStore.getTotalCount.mockResolvedValue(0);

    await request(app)
      .get("/api/memories?limit=10&offset=20")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(mockBucketStore.getAllBuckets).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, offset: 20 })
    );
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/memories");
    expect(res.status).toBe(401);
  });

  it("handles database errors", async () => {
    mockBucketStore.getAllBuckets.mockRejectedValue(new Error("Connection failed"));

    const res = await request(app)
      .get("/api/memories")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(500);
  });
});

describe("GET /api/memories/stats", () => {
  it("returns memory statistics", async () => {
    mockBucketStore.countByCategory.mockResolvedValue({
      strong: 10,
      fading: 5,
      critical: 2,
      forgotten: 1,
    });
    mockBucketStore.countByType.mockResolvedValue({ code: 8, fact: 10 });
    mockBucketStore.getTotalCount.mockResolvedValue(18);
    mockRelationshipStore.getTotalCount.mockResolvedValue(25);
    mockRawStore.getTotalMessages.mockResolvedValue(100);
    mockRawStore.getTotalSessions.mockResolvedValue(5);
    mockStrengthTracker.bulkStatus.mockResolvedValue({
      summary: { averageStrength: 0.72 },
    });

    const res = await request(app)
      .get("/api/memories/stats")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.totalBuckets).toBe(18);
    expect(res.body.bucketsByType).toBeDefined();
    expect(res.body.totalRelationships).toBe(25);
    expect(res.body.totalMessages).toBe(100);
    expect(res.body.averageStrength).toBe(0.72);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/memories/stats");
    expect(res.status).toBe(401);
  });
});

describe("GET /api/memories/:bucketId", () => {
  it("returns bucket with items", async () => {
    mockBucketStore.getBucketById.mockResolvedValue({
      bucket: BUCKET_1,
      items: [ITEM_1],
    });
    mockRelationshipStore.getAllConnected.mockResolvedValue([]);
    mockStrengthTracker.getDecayCurveForBucket.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/memories/bucket-1")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.bucket.bucketId).toBe("bucket-1");
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].label).toBe("TypeScript");
  });

  it("returns 404 for non-existent bucket", async () => {
    mockBucketStore.getBucketById.mockResolvedValue(null);

    const res = await request(app)
      .get("/api/memories/nonexistent")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(404);
  });

  it("includes relationships when available", async () => {
    mockBucketStore.getBucketById.mockResolvedValue({
      bucket: BUCKET_1,
      items: [ITEM_1],
    });
    mockRelationshipStore.getAllConnected.mockResolvedValue([
      {
        relationshipId: "rel-1",
        connectedBucketId: "bucket-2",
        connectedBucketName: "React Hooks",
        relationType: "related_to",
        confidence: 0.85,
        direction: "outgoing",
      },
    ]);
    mockStrengthTracker.getDecayCurveForBucket.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/memories/bucket-1")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.relationships).toHaveLength(1);
    expect(res.body.relationships[0].relationType).toBe("related_to");
  });

  it("returns 401 without auth", async () => {
    const res = await request(app).get("/api/memories/bucket-1");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /api/memories/:bucketId", () => {
  it("updates bucket canonical label", async () => {
    mockBucketStore.getBucketById.mockResolvedValue({
      bucket: BUCKET_1,
      items: [ITEM_1],
    });
    mockBucketStore.updateBucket.mockResolvedValue(undefined);

    const res = await request(app)
      .patch("/api/memories/bucket-1")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ canonical: "Updated Label" });

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("updated");
  });

  it("updates bucket importance", async () => {
    mockBucketStore.getBucketById.mockResolvedValue({
      bucket: BUCKET_1,
      items: [ITEM_1],
    });
    mockBucketStore.updateBucket.mockResolvedValue(undefined);

    const res = await request(app)
      .patch("/api/memories/bucket-1")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ importance: 9 });

    expect(res.status).toBe(200);
  });

  it("returns 404 for non-existent bucket", async () => {
    mockBucketStore.getBucketById.mockResolvedValue(null);

    const res = await request(app)
      .patch("/api/memories/nonexistent")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ canonical: "New Name" });

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid importance", async () => {
    mockBucketStore.getBucketById.mockResolvedValue({
      bucket: BUCKET_1,
      items: [ITEM_1],
    });

    const res = await request(app)
      .patch("/api/memories/bucket-1")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({ importance: 15 });

    expect(res.status).toBe(400);
  });

  it("returns 400 for empty body", async () => {
    mockBucketStore.getBucketById.mockResolvedValue({
      bucket: BUCKET_1,
      items: [ITEM_1],
    });

    const res = await request(app)
      .patch("/api/memories/bucket-1")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .patch("/api/memories/bucket-1")
      .send({ canonical: "New Name" });

    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/memories/:bucketId", () => {
  it("deletes a bucket", async () => {
    mockBucketStore.getBucketById.mockResolvedValue({
      bucket: BUCKET_1,
      items: [ITEM_1],
    });
    mockEmbeddingStore.deleteEmbedding.mockResolvedValue(undefined);
    mockRelationshipStore.deleteByBucket.mockResolvedValue(undefined);
    mockBucketStore.deleteBucket.mockResolvedValue(undefined);

    const res = await request(app)
      .delete("/api/memories/bucket-1")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain("deleted");
  });

  it("returns 404 for non-existent bucket", async () => {
    mockBucketStore.getBucketById.mockResolvedValue(null);

    const res = await request(app)
      .delete("/api/memories/nonexistent")
      .set("Authorization", `Bearer ${AUTH_TOKEN}`);

    expect(res.status).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const res = await request(app)
      .delete("/api/memories/bucket-1");

    expect(res.status).toBe(401);
  });
});