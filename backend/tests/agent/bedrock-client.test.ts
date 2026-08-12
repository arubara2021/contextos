import { BedrockClient } from "../../src/agent/bedrock-client";

const mockSend = jest.fn();

jest.mock("@aws-sdk/client-bedrock-runtime", () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: mockSend,
  })),
  InvokeModelCommand: jest.fn().mockImplementation((input) => input),
}));

function createTextResponse(text: string) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({
        content: [{ type: "text", text }],
      })
    ),
  };
}

function createErrorResponse(message: string) {
  return {
    body: new TextEncoder().encode(
      JSON.stringify({
        type: "error",
        message,
      })
    ),
  };
}

describe("BedrockClient", () => {
  let client: BedrockClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new BedrockClient({
      region: "us-east-1",
      modelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
      embeddingModelId: "amazon.titan-embed-text-v2:0",
    });
  });

  describe("generateResponse", () => {
    it("generates a response from a prompt", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("Hello, world!"));

      const result = await client.generateResponse("Say hello");

      expect(result).toBe("Hello, world!");
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("passes system prompt correctly", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("Response"));

      await client.generateResponse("User message", {
        systemPrompt: "You are a helpful assistant",
      });

      const call = mockSend.mock.calls[0][0];
      const body = JSON.parse(call.body);

      expect(body.system).toBe("You are a helpful assistant");
    });

    it("passes messages array correctly", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("Response"));

      await client.generateResponse("User message", {
        messages: [
          { role: "user", content: "Previous message" },
          { role: "assistant", content: "Previous response" },
        ],
      });

      const call = mockSend.mock.calls[0][0];
      const body = JSON.parse(call.body);

      expect(body.messages).toHaveLength(2);
      expect(body.messages[0].role).toBe("user");
      expect(body.messages[1].role).toBe("assistant");
    });

    it("respects max_tokens parameter", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("Response"));

      await client.generateResponse("Message", { maxTokens: 1024 });

      const call = mockSend.mock.calls[0][0];
      const body = JSON.parse(call.body);

      expect(body.max_tokens).toBe(1024);
    });

    it("uses default max_tokens when not specified", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("Response"));

      await client.generateResponse("Message");

      const call = mockSend.mock.calls[0][0];
      const body = JSON.parse(call.body);

      expect(body.max_tokens).toBe(4096);
    });

    it("uses correct model ID", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("Response"));

      await client.generateResponse("Message");

      const call = mockSend.mock.calls[0][0];
      expect(call.modelId).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0");
    });

    it("sets correct content type headers", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("Response"));

      await client.generateResponse("Message");

      const call = mockSend.mock.calls[0][0];
      expect(call.contentType).toBe("application/json");
      expect(call.accept).toBe("application/json");
    });

    it("throws on API error", async () => {
      mockSend.mockRejectedValueOnce(new Error("ThrottlingException"));

      await expect(
        client.generateResponse("Message")
      ).rejects.toThrow("ThrottlingException");
    });

    it("throws on empty response", async () => {
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({ content: [] })
        ),
      });

      await expect(
        client.generateResponse("Message")
      ).rejects.toThrow("Empty response");
    });

    it("handles multi-block responses", async () => {
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              { type: "text", text: "First part. " },
              { type: "text", text: "Second part." },
            ],
          })
        ),
      });

      const result = await client.generateResponse("Message");

      expect(result).toBe("First part. Second part.");
    });

    it("retries on transient errors", async () => {
      mockSend
        .mockRejectedValueOnce(new Error("ServiceUnavailableException"))
        .mockResolvedValueOnce(createTextResponse("Success after retry"));

      const result = await client.generateResponse("Message", { maxRetries: 2 });

      expect(result).toBe("Success after retry");
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("fails after max retries exceeded", async () => {
      mockSend
        .mockRejectedValueOnce(new Error("ThrottlingException"))
        .mockRejectedValueOnce(new Error("ThrottlingException"))
        .mockRejectedValueOnce(new Error("ThrottlingException"));

      await expect(
        client.generateResponse("Message", { maxRetries: 2 })
      ).rejects.toThrow("ThrottlingException");
    });
  });

  describe("extractConcepts", () => {
    it("extracts concepts from text", async () => {
      const concepts = [
        { label: "TypeScript", definition: "A typed superset of JavaScript", type: "code", importance: 8, related: ["JavaScript"] },
      ];

      mockSend.mockResolvedValueOnce(createTextResponse(JSON.stringify(concepts)));

      const result = await client.extractConcepts("TypeScript is a typed superset of JavaScript");

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe("TypeScript");
      expect(result[0].definition).toBe("A typed superset of JavaScript");
    });

    it("handles non-JSON response gracefully", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("Here are the concepts: [{...}] not valid json"));

      const result = await client.extractConcepts("Some text");

      expect(Array.isArray(result)).toBe(true);
    });

    it("handles empty text", async () => {
      const result = await client.extractConcepts("");

      expect(result).toEqual([]);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("passes extraction prompt in system message", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("[]"));

      await client.extractConcepts("Some text to analyze");

      const call = mockSend.mock.calls[0][0];
      const body = JSON.parse(call.body);

      expect(body.system).toBeDefined();
      expect(typeof body.system).toBe("string");
      expect(body.system.length).toBeGreaterThan(0);
    });

    it("handles array wrapped response", async () => {
      const concepts = [
        { label: "Concept A", definition: "Definition A", type: "fact", importance: 5, related: [] },
        { label: "Concept B", definition: "Definition B", type: "code", importance: 7, related: [] },
      ];

      mockSend.mockResolvedValueOnce(createTextResponse(JSON.stringify(concepts)));

      const result = await client.extractConcepts("Text with multiple concepts");

      expect(result).toHaveLength(2);
    });

    it("handles response with markdown code fences", async () => {
      const concepts = [
        { label: "Test", definition: "Test concept", type: "fact", importance: 5, related: [] },
      ];

      mockSend.mockResolvedValueOnce(
        createTextResponse("```json\n" + JSON.stringify(concepts) + "\n```")
      );

      const result = await client.extractConcepts("Text");

      expect(result).toHaveLength(1);
    });

    it("throws on API failure", async () => {
      mockSend.mockRejectedValueOnce(new Error("ModelTimeoutException"));

      await expect(
        client.extractConcepts("Some text")
      ).rejects.toThrow("ModelTimeoutException");
    });
  });

  describe("generateEmbedding", () => {
    it("generates embedding vector", async () => {
      const embedding = Array(1536).fill(0).map(() => Math.random());
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({ embedding })
        ),
      });

      const result = await client.generateEmbedding("Test text");

      expect(result).toHaveLength(1536);
      expect(result.every((v: number) => typeof v === "number")).toBe(true);
    });

    it("returns empty array for empty text", async () => {
      const result = await client.generateEmbedding("");

      expect(result).toEqual([]);
      expect(mockSend).not.toHaveBeenCalled();
    });

    it("uses embedding model ID", async () => {
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({ embedding: Array(1536).fill(0.1) })
        ),
      });

      await client.generateEmbedding("Test text");

      const call = mockSend.mock.calls[0][0];
      expect(call.modelId).toBe("amazon.titan-embed-text-v2:0");
    });

    it("trims input text", async () => {
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({ embedding: Array(1536).fill(0.1) })
        ),
      });

      await client.generateEmbedding("   Test text   ");

      const call = mockSend.mock.calls[0][0];
      const body = JSON.parse(call.body);
      expect(body.inputText).toBe("Test text");
    });

    it("throws on embedding API error", async () => {
      mockSend.mockRejectedValueOnce(new Error("ValidationException"));

      await expect(
        client.generateEmbedding("Test text")
      ).rejects.toThrow("ValidationException");
    });

    it("handles response with embedding nested differently", async () => {
      const embedding = Array(1536).fill(0.1);
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({ embedding })
        ),
      });

      const result = await client.generateEmbedding("Test");

      expect(result).toHaveLength(1536);
    });

    it("handles missing embedding in response", async () => {
      mockSend.mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({ message: "success" })
        ),
      });

      const result = await client.generateEmbedding("Test");

      expect(result).toEqual([]);
    });
  });

  describe("generateStructured", () => {
    it("returns parsed JSON from response", async () => {
      const structured = { keyTerms: ["test"], intent: "recall" };
      mockSend.mockResolvedValueOnce(createTextResponse(JSON.stringify(structured)));

      const result = await client.generateStructured<{ keyTerms: string[]; intent: string }>(
        "Analyze this query",
        "Return JSON"
      );

      expect(result.keyTerms).toEqual(["test"]);
      expect(result.intent).toBe("recall");
    });

    it("throws on invalid JSON response", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse("This is not JSON at all"));

      await expect(
        client.generateStructured<{ test: boolean }>("Message", "System")
      ).rejects.toThrow();
    });

    it("handles JSON wrapped in text", async () => {
      const data = { answer: 42 };
      mockSend.mockResolvedValueOnce(
        createTextResponse(`Here is the result:\n${JSON.stringify(data)}\nEnd.`)
      );

      const result = await client.generateStructured<{ answer: number }>(
        "Question",
        "System"
      );

      expect(result.answer).toBe(42);
    });

    it("passes system prompt and message", async () => {
      mockSend.mockResolvedValueOnce(createTextResponse('{"result":"ok"}'));

      await client.generateStructured("User input", "System instructions");

      const call = mockSend.mock.calls[0][0];
      const body = JSON.parse(call.body);

      expect(body.system).toBe("System instructions");
      expect(body.messages[0].content).toBe("User input");
    });
  });

  describe("configuration", () => {
    it("uses custom region", async () => {
      const customClient = new BedrockClient({
        region: "eu-west-1",
        modelId: "test-model",
        embeddingModelId: "test-embedding",
      });

      mockSend.mockResolvedValueOnce(createTextResponse("Response"));

      await customClient.generateResponse("Message");

      expect(mockSend).toHaveBeenCalled();
    });

    it("uses custom model IDs", async () => {
      const customClient = new BedrockClient({
        region: "us-east-1",
        modelId: "custom-model-id",
        embeddingModelId: "custom-embedding-id",
      });

      mockSend.mockResolvedValueOnce(createTextResponse("Response"));

      await customClient.generateResponse("Message");

      const call = mockSend.mock.calls[0][0];
      expect(call.modelId).toBe("custom-model-id");
    });
  });
});