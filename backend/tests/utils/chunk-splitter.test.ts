import {
  splitIntoChunks,
  estimateTokens,
  estimateTokensFast,
  chunkText,
  getChunkingStats,
} from "../../src/utils/chunk-splitter";

describe("splitIntoChunks", () => {
  it("returns empty array for empty text", () => {
    expect(splitIntoChunks("")).toEqual([]);
  });

  it("returns empty array for whitespace-only text", () => {
    expect(splitIntoChunks("   \n\n   ")).toEqual([]);
  });

  it("returns single chunk for short text", () => {
    const text = "This is a short message about testing.";
    const result = splitIntoChunks(text);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe(text);
    expect(result[0].index).toBe(0);
    expect(result[0].tokenEstimate).toBeGreaterThan(0);
    expect(result[0].startOffset).toBe(0);
  });

  it("splits long text into multiple chunks", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 15; i++) {
      paragraphs.push(
        `Paragraph ${i}: ${"word ".repeat(60)}End of paragraph ${i}.`
      );
    }
    const text = paragraphs.join("\n\n");

    const result = splitIntoChunks(text);

    expect(result.length).toBeGreaterThanOrEqual(2);

    result.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    });
  });

  it("respects custom maxTokens", () => {
    const text = "word ".repeat(200);
    const result = splitIntoChunks(text, { maxTokens: 50 });

    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("respects custom minTokens for merging", () => {
    const text = "Short paragraph one.\n\nShort paragraph two.";
    const result = splitIntoChunks(text, { minTokens: 5 });

    expect(result).toHaveLength(1);
  });

  it("preserves content across chunks", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 10; i++) {
      paragraphs.push(`UniqueMarker${i} ${"word ".repeat(40)}`);
    }
    const text = paragraphs.join("\n\n");
    const result = splitIntoChunks(text);

    const combined = result.map((c) => c.text).join(" ");
    for (let i = 0; i < 10; i++) {
      expect(combined).toContain(`UniqueMarker${i}`);
    }
  });

  it("assigns sequential indices", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 10; i++) {
      paragraphs.push(`${"word ".repeat(50)}Paragraph ${i} end.`);
    }
    const text = paragraphs.join("\n\n");
    const result = splitIntoChunks(text);

    result.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
    });
  });

  it("includes tokenEstimate for each chunk", () => {
    const text = "This is a test paragraph with enough words to be meaningful for token estimation.";
    const result = splitIntoChunks(text);

    expect(result[0].tokenEstimate).toBeGreaterThan(0);
  });

  it("includes splitMethod for each chunk", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 10; i++) {
      paragraphs.push(`${"word ".repeat(50)}End.`);
    }
    const text = paragraphs.join("\n\n");
    const result = splitIntoChunks(text);

    result.forEach((chunk) => {
      expect(["paragraph", "sentence", "word", "forced"]).toContain(
        chunk.splitMethod
      );
    });
  });

  it("includes startOffset and endOffset", () => {
    const text = "A meaningful paragraph with enough words for token estimation purposes here.";
    const result = splitIntoChunks(text);

    expect(result[0].startOffset).toBe(0);
    expect(result[0].endOffset).toBeGreaterThan(0);
  });

  it("normalizes CRLF line endings", () => {
    const text = "Line one\r\n\r\nLine two\r\n\r\nLine three";
    const result = splitIntoChunks(text);

    expect(result).toHaveLength(1);
    expect(result[0].text).not.toContain("\r");
  });

  it("collapses triple newlines", () => {
    const text = "Line one\n\n\n\n\nLine two";
    const result = splitIntoChunks(text);

    expect(result).toHaveLength(1);
    expect(result[0].text).not.toContain("\n\n\n");
  });

  it("handles single long paragraph", () => {
    const text = "word ".repeat(500);
    const result = splitIntoChunks(text);

    expect(result.length).toBeGreaterThanOrEqual(1);
    result.forEach((chunk) => {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    });
  });

  it("handles text with code blocks when preserveCodeBlocks is true", () => {
    const text =
      "Before paragraph.\n\n```typescript\nconst x = 1;\nconsole.log(x);\n```\n\nAfter paragraph.";
    const result = splitIntoChunks(text, { preserveCodeBlocks: true });

    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("splits at sentence boundaries when paragraphs are too large", () => {
    const sentences: string[] = [];
    for (let i = 0; i < 10; i++) {
      sentences.push(
        `Sentence number ${i} contains enough words to be meaningful for chunking and token estimation.`
      );
    }
    const text = sentences.join(" ");
    const result = splitIntoChunks(text, { maxTokens: 30 });

    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 0 for null input", () => {
    expect(estimateTokens(null as any)).toBe(0);
  });

  it("estimates tokens for short text", () => {
    const result = estimateTokens("Hello world");
    expect(result).toBe(2);
  });

  it("accounts for long words", () => {
    const shortWords = "a b c d e";
    const longWords = "authentication implementation configuration";

    const shortTokens = estimateTokens(shortWords);
    const longTokens = estimateTokens(longWords);

    expect(longTokens).toBeGreaterThan(shortTokens);
  });

  it("returns higher estimate for longer text", () => {
    const short = "Hello world";
    const long = "Hello world ".repeat(100);

    expect(estimateTokens(long)).toBeGreaterThan(estimateTokens(short));
  });

  it("handles single word", () => {
    expect(estimateTokens("TypeScript")).toBeGreaterThan(0);
  });

  it("handles multiple spaces between words", () => {
    const result = estimateTokens("word   word   word");
    expect(result).toBe(3);
  });
});

describe("estimateTokensFast", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokensFast("")).toBe(0);
  });

  it("returns 0 for null input", () => {
    expect(estimateTokensFast(null as any)).toBe(0);
  });

  it("estimates roughly 1 token per 4 characters", () => {
    const text = "abcdefghijklmnop";
    const result = estimateTokensFast(text);
    expect(result).toBe(4);
  });

  it("rounds up for partial tokens", () => {
    const text = "abcde";
    const result = estimateTokensFast(text);
    expect(result).toBe(2);
  });
});

describe("chunkText", () => {
  it("returns array of strings", () => {
    const result = chunkText("Hello world");
    expect(Array.isArray(result)).toBe(true);
    expect(typeof result[0]).toBe("string");
  });

  it("returns single string for short text", () => {
    const result = chunkText("Short text.");
    expect(result).toHaveLength(1);
  });

  it("respects custom token limits", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 10; i++) {
      paragraphs.push(`${"word ".repeat(40)}End.`);
    }
    const text = paragraphs.join("\n\n");

    const result = chunkText(text, 50, 100);

    expect(result.length).toBeGreaterThanOrEqual(2);
  });
});

describe("getChunkingStats", () => {
  it("returns correct stats for empty array", () => {
    const stats = getChunkingStats([]);

    expect(stats.totalChunks).toBe(0);
    expect(stats.totalTokens).toBe(0);
    expect(stats.averageTokensPerChunk).toBe(0);
    expect(stats.minChunkTokens).toBe(0);
    expect(stats.maxChunkTokens).toBe(0);
  });

  it("returns correct stats for single chunk", () => {
    const chunks = splitIntoChunks("This is a test paragraph with enough words here.");

    const stats = getChunkingStats(chunks);

    expect(stats.totalChunks).toBe(1);
    expect(stats.totalTokens).toBeGreaterThan(0);
    expect(stats.averageTokensPerChunk).toBeGreaterThan(0);
    expect(stats.minChunkTokens).toBe(stats.maxChunkTokens);
  });

  it("returns correct stats for multiple chunks", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 10; i++) {
      paragraphs.push(`${"word ".repeat(50)}End.`);
    }
    const chunks = splitIntoChunks(paragraphs.join("\n\n"));

    const stats = getChunkingStats(chunks);

    expect(stats.totalChunks).toBeGreaterThanOrEqual(2);
    expect(stats.totalTokens).toBeGreaterThan(0);
    expect(stats.averageTokensPerChunk).toBeGreaterThan(0);
    expect(stats.minChunkTokens).toBeLessThanOrEqual(stats.maxChunkTokens);
  });

  it("counts split methods correctly", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 10; i++) {
      paragraphs.push(`${"word ".repeat(50)}End.`);
    }
    const chunks = splitIntoChunks(paragraphs.join("\n\n"));
    const stats = getChunkingStats(chunks);

    expect(stats.splitMethods).toBeDefined();
    expect(typeof stats.splitMethods).toBe("object");

    const totalCounted = Object.values(stats.splitMethods).reduce(
      (a, b) => a + b,
      0
    );
    expect(totalCounted).toBe(stats.totalChunks);
  });

  it("total tokens equals sum of individual chunks", () => {
    const paragraphs: string[] = [];
    for (let i = 0; i < 5; i++) {
      paragraphs.push(`${"word ".repeat(40)}End.`);
    }
    const chunks = splitIntoChunks(paragraphs.join("\n\n"));
    const stats = getChunkingStats(chunks);

    const manualTotal = chunks.reduce(
      (sum, c) => sum + c.tokenEstimate,
      0
    );
    expect(stats.totalTokens).toBe(manualTotal);
  });
});