import request from "supertest";
import express from "express";
import chatRouter from "../../src/api/chat.routes";

jest.mock("../../src/api/dependencies", () => ({
  getDependencies: jest.fn(),
}));

jest.mock("../../src/auth/middleware", () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    if (!req.headers.authorization) {
      return _res.status(401).json({ error: "No token provided" });
    }
    req.userId = "user-123";
    next();
  },
}));

const { getDependencies } = require("../../src/api/dependencies");

const mockDeps = {
  ingestionPipeline: { ingestMessage: jest.fn() },
  sessionStore: { exists: jest.fn(), updateSessionActivity: jest.fn() },
  rawStore: { storeMessage: jest.fn(), getMessageHistory: jest.fn() },
  queryAnalyzer: { analyze: jest.fn() },
  retriever: { retrieve: jest.fn() },
  scorer: { score: jest.fn() },
  assembler: { assemble: jest.fn() },
  modelRouter: { send: jest.fn() },
  promptBuilder: { buildSystemContextPrompt: jest.fn() },
  strengthTracker: { onMultiAccess: jest.fn() },
  responseProcessor: { processResponse: jest.fn() },
};

const app = express();
app.use(express.json());
app.use("/api/chat", chatRouter);

beforeEach(() => {
  jest.clearAllMocks();
  getDependencies.mockReturnValue(mockDeps);
});

describe("POST /api/chat", () => {
  it("processes a chat message successfully", async () => {
    mockDeps.sessionStore.exists.mockResolvedValue(true);
    mockDeps.sessionStore.updateSessionActivity.mockResolvedValue(undefined);

    mockDeps.ingestionPipeline.ingestMessage.mockResolvedValue({
      conceptsExtracted: 2,
      newBuckets: 1,
      mergedBuckets: 0,
      relationshipsMapped: 1,
    });

    mockDeps.queryAnalyzer.analyze.mockResolvedValue({
      keyTerms: ["test"],
      intent: "recall",
      specificity: 0.5,
    });

    mockDeps.retriever.retrieve.mockResolvedValue({
      candidates: [],
    });

    mockDeps.scorer.score.mockReturnValue({
      scored: [],
    });

    mockDeps.assembler.assemble.mockReturnValue({
      contextBlock: { rawText: "", memories: [], totalCandidates: 0, budgetUsed: 0, budgetMax: 10 },
      selectedMemories: [],
      availableMemories: [],
    });

    mockDeps.promptBuilder.buildSystemContextPrompt.mockReturnValue({
      systemPrompt: "System prompt",
      userPrompt: "Hello world",
    });

    mockDeps.modelRouter.send.mockResolvedValue({
      response: "Hi there!",
      modelUsed: "claude-3",
    });

    mockDeps.rawStore.storeMessage.mockResolvedValue("msg-1");

    mockDeps.responseProcessor.processResponse.mockReturnValue({
      summary: "Hi there!",
    });

    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "Hello world", sessionId: "session-123" });

    expect(res.status).toBe(200);
    expect(res.body.message.role).toBe("assistant");
    expect(res.body.message.content).toBe("Hi there!");
    expect(res.body.processingStats).toBeDefined();
  });

  it("returns 400 for missing message", async () => {
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ sessionId: "session-123" });

    expect(res.status).toBe(400);
  });

  it("returns 400 for missing sessionId", async () => {
    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "Hello" });

    expect(res.status).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const appNoAuth = express();
    appNoAuth.use(express.json());
    appNoAuth.use("/api/chat", chatRouter);

    const res = await request(appNoAuth)
      .post("/api/chat")
      .send({ message: "Hello", sessionId: "session-123" });

    expect(res.status).toBe(401);
  });

  it("returns 404 for non-existent session", async () => {
    mockDeps.sessionStore.exists.mockResolvedValue(false);

    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "Hello", sessionId: "nonexistent" });

    expect(res.status).toBe(404);
  });

  it("handles ingestion errors", async () => {
    mockDeps.sessionStore.exists.mockResolvedValue(true);
    mockDeps.sessionStore.updateSessionActivity.mockResolvedValue(undefined);
    mockDeps.ingestionPipeline.ingestMessage.mockRejectedValue(
      new Error("Ingestion failed")
    );

    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "Hello", sessionId: "session-123" });

    expect(res.status).toBe(500);
  });

  it("includes injected memories in response", async () => {
    mockDeps.sessionStore.exists.mockResolvedValue(true);
    mockDeps.sessionStore.updateSessionActivity.mockResolvedValue(undefined);

    mockDeps.ingestionPipeline.ingestMessage.mockResolvedValue({
      conceptsExtracted: 0,
      newBuckets: 0,
      mergedBuckets: 0,
      relationshipsMapped: 0,
    });

    mockDeps.queryAnalyzer.analyze.mockResolvedValue({
      keyTerms: ["test"],
      intent: "recall",
      specificity: 0.5,
    });

    mockDeps.retriever.retrieve.mockResolvedValue({ candidates: [] });
    mockDeps.scorer.score.mockReturnValue({ scored: [] });

    mockDeps.assembler.assemble.mockReturnValue({
      contextBlock: { rawText: "", memories: [], totalCandidates: 1, budgetUsed: 1, budgetMax: 10 },
      selectedMemories: [{ bucketId: "b1", label: "TypeScript", definition: "Typed JS", strength: 0.9 }],
      availableMemories: [],
    });

    mockDeps.promptBuilder.buildSystemContextPrompt.mockReturnValue({
      systemPrompt: "System",
      userPrompt: "Test",
    });

    mockDeps.modelRouter.send.mockResolvedValue({
      response: "Response",
      modelUsed: "claude-3",
    });

    mockDeps.rawStore.storeMessage.mockResolvedValue("msg-2");
    mockDeps.responseProcessor.processResponse.mockReturnValue({});

    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "Test", sessionId: "session-123" });

    expect(res.status).toBe(200);
    expect(res.body.injectedMemories).toHaveLength(1);
    expect(res.body.injectedMemories[0].label).toBe("TypeScript");
  });

  it("updates strength tracker for injected memories", async () => {
    mockDeps.sessionStore.exists.mockResolvedValue(true);
    mockDeps.sessionStore.updateSessionActivity.mockResolvedValue(undefined);

    mockDeps.ingestionPipeline.ingestMessage.mockResolvedValue({
      conceptsExtracted: 0,
      newBuckets: 0,
      mergedBuckets: 0,
      relationshipsMapped: 0,
    });

    mockDeps.queryAnalyzer.analyze.mockResolvedValue({
      keyTerms: [],
      intent: "recall",
      specificity: 0.5,
    });

    mockDeps.retriever.retrieve.mockResolvedValue({ candidates: [] });
    mockDeps.scorer.score.mockReturnValue({ scored: [] });

    mockDeps.assembler.assemble.mockReturnValue({
      contextBlock: { rawText: "", memories: [], totalCandidates: 2, budgetUsed: 2, budgetMax: 10 },
      selectedMemories: [
        { bucketId: "b1", label: "A", definition: "A def", strength: 0.8 },
        { bucketId: "b2", label: "B", definition: "B def", strength: 0.7 },
      ],
      availableMemories: [],
    });

    mockDeps.promptBuilder.buildSystemContextPrompt.mockReturnValue({
      systemPrompt: "System",
      userPrompt: "Test",
    });

    mockDeps.modelRouter.send.mockResolvedValue({
      response: "Response",
      modelUsed: "claude-3",
    });

    mockDeps.rawStore.storeMessage.mockResolvedValue("msg-3");
    mockDeps.responseProcessor.processResponse.mockReturnValue({});

    const res = await request(app)
      .post("/api/chat")
      .set("Authorization", "Bearer valid-token")
      .send({ message: "Test", sessionId: "session-123" });

    expect(res.status).toBe(200);
    expect(mockDeps.strengthTracker.onMultiAccess).toHaveBeenCalledWith(["b1", "b2"]);
  });
});

describe("GET /api/chat/:sessionId/history", () => {
  it("returns message history for a session", async () => {
    mockDeps.sessionStore.exists.mockResolvedValue(true);
    mockDeps.rawStore.getMessageHistory.mockResolvedValue([
      { messageId: "m1", role: "user", content: "Hello", timestamp: new Date() },
      { messageId: "m2", role: "assistant", content: "Hi there!", timestamp: new Date() },
    ]);

    const res = await request(app)
      .get("/api/chat/session-123/history")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(2);
    expect(res.body.sessionId).toBe("session-123");
    expect(res.body.count).toBe(2);
  });

  it("returns empty array when no messages", async () => {
    mockDeps.sessionStore.exists.mockResolvedValue(true);
    mockDeps.rawStore.getMessageHistory.mockResolvedValue([]);

    const res = await request(app)
      .get("/api/chat/session-123/history")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(200);
    expect(res.body.messages).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it("returns 404 for non-existent session", async () => {
    mockDeps.sessionStore.exists.mockResolvedValue(false);

    const res = await request(app)
      .get("/api/chat/nonexistent/history")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(404);
  });

  it("returns 401 without auth", async () => {
    const appNoAuth = express();
    appNoAuth.use(express.json());
    appNoAuth.use("/api/chat", chatRouter);

    const res = await request(appNoAuth)
      .get("/api/chat/session-123/history");

    expect(res.status).toBe(401);
  });

  it("handles database errors", async () => {
    mockDeps.sessionStore.exists.mockResolvedValue(true);
    mockDeps.rawStore.getMessageHistory.mockRejectedValue(
      new Error("Connection failed")
    );

    const res = await request(app)
      .get("/api/chat/session-123/history")
      .set("Authorization", "Bearer valid-token");

    expect(res.status).toBe(500);
  });
});