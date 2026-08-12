import { TextNormalizer } from "../../src/ingestion/normalizer";

describe("TextNormalizer", () => {
  let normalizer: TextNormalizer;

  beforeEach(() => {
    normalizer = new TextNormalizer();
  });

  describe("normalizeMessage", () => {
    it("returns empty array for empty content", () => {
      const result = normalizer.normalizeMessage("user", "", "chat:1", "session-1", "2024-01-01");
      expect(result).toEqual([]);
    });

    it("returns empty array for whitespace-only content", () => {
      const result = normalizer.normalizeMessage("user", "   \n\n   ", "chat:1", "session-1", "2024-01-01");
      expect(result).toEqual([]);
    });

    it("returns single chunk for short content", () => {
      const content = "This is a short message about TypeScript.";
      const result = normalizer.normalizeMessage("user", content, "chat:1", "session-1", "2024-01-01");

      expect(result).toHaveLength(1);
      expect(result[0].text).toContain("short message");
      expect(result[0].role).toBe("user");
      expect(result[0].source).toBe("chat:1");
      expect(result[0].sessionId).toBe("session-1");
      expect(result[0].timestamp).toBe("2024-01-01");
      expect(result[0].chunkIndex).toBe(0);
      expect(result[0].tokenEstimate).toBeGreaterThan(0);
    });

    it("strips markdown formatting", () => {
      const content = "## Header\n\n**Bold text** and *italic* and `code`";
      const result = normalizer.normalizeMessage("user", content, "chat:1", "session-1", "2024-01-01");

      expect(result).toHaveLength(1);
      expect(result[0].text).not.toContain("**");
      expect(result[0].text).not.toContain("*");
      expect(result[0].text).not.toContain("`");
      expect(result[0].text).not.toContain("##");
    });

    it("strips code blocks", () => {
      const content = "Before\n\n```typescript\nconst x = 1;\nconsole.log(x);\n```\n\nAfter";
      const result = normalizer.normalizeMessage("user", content, "chat:1", "session-1", "2024-01-01");

      expect(result).toHaveLength(1);
      expect(result[0].text).not.toContain("```");
      expect(result[0].text).toContain("Before");
      expect(result[0].text).toContain("After");
    });

    it("strips links preserving text", () => {
      const content = "Check [this link](https://example.com) for details.";
      const result = normalizer.normalizeMessage("user", content, "chat:1", "session-1", "2024-01-01");

      expect(result).toHaveLength(1);
      expect(result[0].text).toContain("this link");
      expect(result[0].text).not.toContain("https://example.com");
      expect(result[0].text).not.toContain("](");
    });

    it("splits long content into multiple chunks", () => {
      const paragraphs: string[] = [];
      for (let i = 0; i < 20; i++) {
        paragraphs.push(
          `Paragraph ${i}: ${"word ".repeat(50)}This is additional content to make it longer and more realistic for testing purposes.`
        );
      }
      const content = paragraphs.join("\n\n");
      const result = normalizer.normalizeMessage("user", content, "chat:1", "session-1", "2024-01-01");

      expect(result.length).toBeGreaterThanOrEqual(2);
      result.forEach((chunk, index) => {
        expect(chunk.chunkIndex).toBe(index);
        expect(chunk.role).toBe("user");
        expect(chunk.sessionId).toBe("session-1");
        expect(chunk.text.trim().length).toBeGreaterThan(0);
      });
    });

    it("preserves role and source metadata", () => {
      const content = "A message with metadata.";
      const result = normalizer.normalizeMessage("assistant", content, "doc:myfile.txt", "sess-abc", "2024-06-15T10:30:00Z");

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("assistant");
      expect(result[0].source).toBe("doc:myfile.txt");
      expect(result[0].sessionId).toBe("sess-abc");
      expect(result[0].timestamp).toBe("2024-06-15T10:30:00Z");
    });

    it("handles content with only code blocks", () => {
      const content = "```js\nconst a = 1;\nconst b = 2;\n```";
      const result = normalizer.normalizeMessage("user", content, "chat:1", "session-1", "2024-01-01");

      expect(result.length).toBeLessThanOrEqual(1);
    });

    it("collapses multiple newlines", () => {
      const content = "Line 1\n\n\n\n\nLine 2\n\n\n\nLine 3";
      const result = normalizer.normalizeMessage("user", content, "chat:1", "session-1", "2024-01-01");

      expect(result).toHaveLength(1);
      expect(result[0].text).not.toContain("\n\n\n");
    });

    it("removes list markers", () => {
      const content = "- Item one\n- Item two\n- Item three\n1. First\n2. Second";
      const result = normalizer.normalizeMessage("user", content, "chat:1", "session-1", "2024-01-01");

      expect(result).toHaveLength(1);
      expect(result[0].text).not.toMatch(/^- /);
      expect(result[0].text).not.toMatch(/^\d+\. /);
    });
  });

  describe("normalizeDocument", () => {
    it("returns empty array for empty content", () => {
      const result = normalizer.normalizeDocument("", "test.txt", ".txt");
      expect(result).toEqual([]);
    });

    it("normalizes document content with proper source", () => {
      const content = "This is document content about machine learning and neural networks.";
      const result = normalizer.normalizeDocument(content, "ml-guide.md", ".md");

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("document");
      expect(result[0].source).toBe("ml-guide.md");
      expect(result[0].sessionId).toBe("doc:ml-guide.md");
      expect(result[0].text).toContain("machine learning");
    });

    it("splits large documents into chunks", () => {
      const sections: string[] = [];
      for (let i = 0; i < 15; i++) {
        sections.push(
          `## Section ${i}\n\n${"This is a paragraph with enough words to be realistic. ".repeat(20)}`
        );
      }
      const content = sections.join("\n\n");
      const result = normalizer.normalizeDocument(content, "large-doc.txt", ".txt");

      expect(result.length).toBeGreaterThanOrEqual(2);
      result.forEach((chunk, index) => {
        expect(chunk.chunkIndex).toBe(index);
        expect(chunk.role).toBe("document");
      });
    });

    it("handles markdown-heavy documents", () => {
      const content = `# Title

## Subtitle

Some **bold** and *italic* text.

\`\`\`python
def hello():
    print("hello")
\`\`\`

- List item 1
- List item 2

[Link text](https://example.com)

> Blockquote here

---

Final paragraph.`;

      const result = normalizer.normalizeDocument(content, "readme.md", ".md");

      expect(result).toHaveLength(1);
      expect(result[0].text).not.toContain("```");
      expect(result[0].text).not.toContain("**");
      expect(result[0].text).not.toContain("#");
      expect(result[0].text).not.toContain("](");
      expect(result[0].text).not.toContain("> ");
    });
  });

  describe("cleanText", () => {
    it("removes code blocks", () => {
      const text = "Before\n```\ncode\n```\nAfter";
      const cleaned = normalizer.cleanText(text);
      expect(cleaned).toContain("Before");
      expect(cleaned).toContain("After");
      expect(cleaned).not.toContain("```");
    });

    it("removes headers", () => {
      const text = "# Header 1\n## Header 2\n### Header 3\nContent";
      const cleaned = normalizer.cleanText(text);
      expect(cleaned).not.toContain("#");
      expect(cleaned).toContain("Content");
    });

    it("removes bold and italic markers", () => {
      const text = "**bold** and *italic* and ***both***";
      const cleaned = normalizer.cleanText(text);
      expect(cleaned).not.toContain("**");
      expect(cleaned).not.toContain("***");
      expect(cleaned).toContain("bold");
      expect(cleaned).toContain("italic");
    });

    it("removes inline code", () => {
      const text = "Use `console.log()` for debugging";
      const cleaned = normalizer.cleanText(text);
      expect(cleaned).not.toContain("`");
      expect(cleaned).toContain("console.log()");
    });

    it("preserves normal text", () => {
      const text = "This is normal text without any markdown.";
      const cleaned = normalizer.cleanText(text);
      expect(cleaned).toBe(text);
    });

    it("collapses whitespace", () => {
      const text = "Too   many    spaces   here";
      const cleaned = normalizer.cleanText(text);
      expect(cleaned).not.toContain("   ");
      expect(cleaned).toContain("Too many spaces here");
    });

    it("trims result", () => {
      const text = "   \n  content  \n  ";
      const cleaned = normalizer.cleanText(text);
      expect(cleaned).toBe("content");
    });

    it("handles empty string", () => {
      expect(normalizer.cleanText("")).toBe("");
    });
  });

  describe("segmentIntoChunks", () => {
    it("returns single chunk for short text", () => {
      const text = "Short text content.";
      const chunks = normalizer.segmentIntoChunks(text);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it("splits at paragraph boundaries", () => {
      const paragraphs: string[] = [];
      for (let i = 0; i < 10; i++) {
        paragraphs.push("Word ".repeat(40) + `Paragraph ${i} end.`);
      }
      const text = paragraphs.join("\n\n");
      const chunks = normalizer.segmentIntoChunks(text);

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      chunks.forEach((chunk) => {
        expect(chunk.trim().length).toBeGreaterThan(0);
      });
    });

    it("handles text with no paragraph breaks", () => {
      const text = "word ".repeat(500);
      const chunks = normalizer.segmentIntoChunks(text);

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      chunks.forEach((chunk) => {
        expect(chunk.trim().length).toBeGreaterThan(0);
      });
    });

    it("returns empty array for empty text", () => {
      expect(normalizer.segmentIntoChunks("")).toEqual([]);
    });

    it("preserves content across chunks", () => {
      const paragraphs: string[] = [];
      for (let i = 0; i < 8; i++) {
        paragraphs.push(`UniqueMarker${i} ${"word ".repeat(30)}`);
      }
      const text = paragraphs.join("\n\n");
      const chunks = normalizer.segmentIntoChunks(text);
      const combined = chunks.join(" ");

      for (let i = 0; i < 8; i++) {
        expect(combined).toContain(`UniqueMarker${i}`);
      }
    });
  });

  describe("token estimation", () => {
    it("returns 0 for empty text", () => {
      const result = normalizer.normalizeMessage("user", "", "chat:1", "session-1", "2024-01-01");
      expect(result).toEqual([]);
    });

    it("estimates more tokens for longer text", () => {
      const short = "Hello world";
      const long = "Hello world ".repeat(100);

      const shortResult = normalizer.normalizeMessage("user", short, "chat:1", "session-1", "2024-01-01");
      const longResult = normalizer.normalizeMessage("user", long, "chat:1", "session-1", "2024-01-01");

      expect(shortResult[0].tokenEstimate).toBeLessThan(longResult[0].tokenEstimate);
    });

    it("accounts for long words having more tokens", () => {
      const shortWords = "a b c d e f g h i j";
      const longWords = "authentication implementation configuration architecture documentation";

      const shortResult = normalizer.normalizeMessage("user", shortWords, "chat:1", "session-1", "2024-01-01");
      const longResult = normalizer.normalizeMessage("user", longWords, "chat:1", "session-1", "2024-01-01");

      expect(longResult[0].tokenEstimate).toBeGreaterThan(shortResult[0].tokenEstimate);
    });
  });
});