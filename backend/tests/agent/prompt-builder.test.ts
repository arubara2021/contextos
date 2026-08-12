import { PromptBuilder } from "../../src/agent/prompt-builder";

describe("PromptBuilder", () => {
  let builder: PromptBuilder;

  beforeEach(() => {
    builder = new PromptBuilder();
  });

  describe("buildSystemPrompt", () => {
    it("builds a basic system prompt", () => {
      const result = builder.buildSystemPrompt({
        role: "You are a helpful assistant.",
      });

      expect(result).toContain("helpful assistant");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("includes context block when provided", () => {
      const result = builder.buildSystemPrompt({
        role: "You are a helpful assistant.",
        contextBlock: "Retrieved memories:\n1. TypeScript: A typed language",
      });

      expect(result).toContain("helpful assistant");
      expect(result).toContain("TypeScript");
    });

    it("includes persona when provided", () => {
      const result = builder.buildSystemPrompt({
        role: "You are a helpful assistant.",
        persona: "You specialize in software architecture and backend development.",
      });

      expect(result).toContain("software architecture");
    });

    it("includes instructions when provided", () => {
      const result = builder.buildSystemPrompt({
        role: "You are a helpful assistant.",
        instructions: [
          "Always cite sources",
          "Be concise",
          "Use examples",
        ],
      });

      expect(result).toContain("Always cite sources");
      expect(result).toContain("Be concise");
      expect(result).toContain("Use examples");
    });

    it("returns non-empty string for minimal input", () => {
      const result = builder.buildSystemPrompt({ role: "Assistant" });

      expect(result.length).toBeGreaterThan(0);
    });

    it("handles empty context block gracefully", () => {
      const result = builder.buildSystemPrompt({
        role: "Assistant",
        contextBlock: "",
      });

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });

    it("handles undefined optional fields", () => {
      const result = builder.buildSystemPrompt({
        role: "Assistant",
      });

      expect(result).toBeDefined();
      expect(result).toContain("Assistant");
    });
  });

  describe("buildUserMessage", () => {
    it("returns the user message as-is for simple input", () => {
      const result = builder.buildUserMessage("What is TypeScript?");

      expect(result).toBe("What is TypeScript?");
    });

    it("includes conversation history when provided", () => {
      const result = builder.buildUserMessage("Follow up question", {
        history: [
          { role: "user", content: "What is TypeScript?" },
          { role: "assistant", content: "TypeScript is a typed superset of JavaScript." },
        ],
      });

      expect(result).toContain("Follow up question");
    });

    it("handles empty history", () => {
      const result = builder.buildUserMessage("Question", { history: [] });

      expect(result).toContain("Question");
    });

    it("handles very long messages", () => {
      const longMessage = "word ".repeat(5000);
      const result = builder.buildUserMessage(longMessage);

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("buildChatMessages", () => {
    it("builds message array for API call", () => {
      const messages = builder.buildChatMessages(
        "You are a helpful assistant.",
        [
          { role: "user", content: "Hello" },
          { role: "assistant", content: "Hi there!" },
          { role: "user", content: "How are you?" },
        ]
      );

      expect(messages).toHaveLength(3);
      expect(messages[0].role).toBe("user");
      expect(messages[0].content).toBe("Hello");
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].content).toBe("Hi there!");
      expect(messages[2].role).toBe("user");
      expect(messages[2].content).toBe("How are you?");
    });

    it("handles single message", () => {
      const messages = builder.buildChatMessages("System", [
        { role: "user", content: "Hello" },
      ]);

      expect(messages).toHaveLength(1);
    });

    it("handles empty conversation", () => {
      const messages = builder.buildChatMessages("System", []);

      expect(messages).toHaveLength(0);
    });

    it("preserves message order", () => {
      const conversation = [
        { role: "user" as const, content: "First" },
        { role: "assistant" as const, content: "Second" },
        { role: "user" as const, content: "Third" },
        { role: "assistant" as const, content: "Fourth" },
      ];

      const messages = builder.buildChatMessages("System", conversation);

      expect(messages[0].content).toBe("First");
      expect(messages[1].content).toBe("Second");
      expect(messages[2].content).toBe("Third");
      expect(messages[3].content).toBe("Fourth");
    });
  });

  describe("buildExtractionPrompt", () => {
    it("builds concept extraction prompt", () => {
      const result = builder.buildExtractionPrompt();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result.toLowerCase()).toContain("concept");
      expect(result.toLowerCase()).toContain("json");
    });

    it("includes output format instructions", () => {
      const result = builder.buildExtractionPrompt();

      expect(result).toContain("label");
      expect(result).toContain("definition");
      expect(result).toContain("type");
      expect(result).toContain("importance");
    });
  });

  describe("buildAnalysisPrompt", () => {
    it("builds query analysis prompt", () => {
      const result = builder.buildAnalysisPrompt();

      expect(result).toBeDefined();
      expect(result.length).toBeGreaterThan(0);
      expect(result.toLowerCase()).toContain("json");
    });
  });

  describe("truncateToFit", () => {
    it("returns text unchanged when under limit", () => {
      const text = "Short text";
      const result = builder.truncateToFit(text, 1000);

      expect(result).toBe(text);
    });

    it("truncates text exceeding token limit", () => {
      const text = "word ".repeat(500);
      const result = builder.truncateToFit(text, 50);

      expect(result.length).toBeLessThan(text.length);
    });

    it("preserves beginning of text when truncating", () => {
      const text = "Important start. " + "filler ".repeat(500);
      const result = builder.truncateToFit(text, 20);

      expect(result).toContain("Important start");
    });

    it("handles empty text", () => {
      const result = builder.truncateToFit("", 100);

      expect(result).toBe("");
    });
  });
});