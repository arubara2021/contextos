// FILE: src/ingestion/normalizer.ts

import config from "../config";
import logger from "../utils/logger";

export interface NormalizedChunk {
  text: string;
  role: string;
  source: string;
  sessionId: string;
  timestamp: string | null;
  chunkIndex: number;
  tokenEstimate: number;
}

const MARKDOWN_PATTERNS: Array<[RegExp, string]> = [
  [/```[\s\S]*?```/g, " "],
  [/`([^`\n]+)`/g, "$1"],
  [/^#{1,6}\s+/gm, ""],
  [/\*{1,3}([^*]+)\*{1,3}/g, "$1"],
  [/_{1,3}([^_]+)_{1,3}/g, "$1"],
  [/$$([^$$]+)\]$$[^)]+$$/g, "$1"],
  [/!$$([^$$]*)\]$$[^)]+$$/g, ""],
  [/^>\s+/gm, ""],
  [/^[-*+]\s+/gm, ""],
  [/^\d+\.\s+/gm, ""],
  [/\|/g, " "],
  [/---+/g, " "],
  [/\n{3,}/g, "\n\n"],
  [/[ \t]{2,}/g, " "],
];

const PARAGRAPH_DELIMITERS = /\n\n+/;
const SENTENCE_DELIMITERS = /(?<=[.!?])\s+/;

export class TextNormalizer {
  private readonly chunkTargetMin: number;
  private readonly chunkTargetMax: number;

  constructor() {
    this.chunkTargetMin = config.memory.chunkTargetMin;
    this.chunkTargetMax = config.memory.chunkTargetMax;
  }

  normalizeMessage(
    role: string,
    content: string,
    source: string,
    sessionId: string,
    timestamp: string
  ): NormalizedChunk[] {
    if (!content || !content.trim()) return [];

    const cleaned = this.cleanText(content);
    if (!cleaned) return [];

    const rawChunks = this.segmentIntoChunks(cleaned);
    return this.tagChunks(rawChunks, role, source, sessionId, timestamp);
  }

  normalizeDocument(
    content: string,
    filename: string,
    fileType: string
  ): NormalizedChunk[] {
    if (!content || !content.trim()) return [];

    const cleaned = this.cleanDocumentText(content, fileType);
    if (!cleaned) return [];

    const rawChunks = this.segmentIntoChunks(cleaned);
    return this.tagChunks(rawChunks, "document", filename, `doc:${filename}`, null);
  }

  cleanText(text: string): string {
    let result = text;

    for (const [pattern, replacement] of MARKDOWN_PATTERNS) {
      result = result.replace(pattern, replacement);
    }

    result = result
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    result = result.replace(/\n{2,}/g, "\n\n");
    result = result.replace(/[ \t]+/g, " ");
    result = result.trim();

    return result;
  }

  cleanDocumentText(text: string, fileType: string): string {
    let result = text;

    if (fileType === "md" || fileType === "markdown") {
      result = result.replace(/```[\s\S]*?```/g, (block) => {
        const inner = block.replace(/^```\w*\n?/, "").replace(/```$/, "");
        return inner.trim();
      });
      result = result.replace(/`([^`\n]+)`/g, "$1");
      result = result.replace(/^#{1,6}\s+/gm, "");
      result = result.replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1");
      result = result.replace(/_{1,3}([^_]+)_{1,3}/g, "$1");
      result = result.replace(/$$([^$$]+)\]$$[^)]+$$/g, "$1");
      result = result.replace(/!$$([^$$]*)\]$$[^)]+$$/g, "");
      result = result.replace(/^>\s+/gm, "");
      result = result.replace(/^[-*+]\s+/gm, "  ");
      result = result.replace(/^\d+\.\s+/gm, "  ");
      result = result.replace(/---+/g, "");
      result = result.replace(/\|/g, " ");
    }

    result = result
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");

    result = result.replace(/\n{3,}/g, "\n\n");
    result = result.replace(/[ \t]+/g, " ");
    result = result.trim();

    return result;
  }

  segmentIntoChunks(text: string): string[] {
    const wordCount = this.estimateTokens(text);

    if (wordCount <= this.chunkTargetMax) {
      return text.length > 0 ? [text] : [];
    }

    const paragraphs = text.split(PARAGRAPH_DELIMITERS);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue;

      const paragraphTokens = this.estimateTokens(paragraph);
      const currentTokens = this.estimateTokens(currentChunk);

      if (paragraphTokens > this.chunkTargetMax) {
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }
        const subChunks = this.splitLargeParagraph(paragraph);
        chunks.push(...subChunks);
        continue;
      }

      if (currentTokens + paragraphTokens > this.chunkTargetMax && currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = paragraph;
      } else {
        currentChunk = currentChunk ? `${currentChunk}\n\n${paragraph}` : paragraph;
      }
    }

    if (currentChunk.trim()) {
      const tokens = this.estimateTokens(currentChunk);
      if (tokens < this.chunkTargetMin && chunks.length > 0) {
        const lastChunk = chunks.pop()!;
        const merged = `${lastChunk}\n\n${currentChunk.trim()}`;
        if (this.estimateTokens(merged) <= this.chunkTargetMax) {
          chunks.push(merged);
        } else {
          chunks.push(lastChunk);
          chunks.push(currentChunk.trim());
        }
      } else {
        chunks.push(currentChunk.trim());
      }
    }

    return chunks.filter((c) => c.length > 0);
  }

  private splitLargeParagraph(paragraph: string): string[] {
    const sentences = paragraph.split(SENTENCE_DELIMITERS);
    const chunks: string[] = [];
    let current = "";

    for (const sentence of sentences) {
      if (!sentence.trim()) continue;

      const sentenceTokens = this.estimateTokens(sentence);
      const currentTokens = this.estimateTokens(current);

      if (sentenceTokens > this.chunkTargetMax) {
        if (current.trim()) {
          chunks.push(current.trim());
          current = "";
        }
        const words = sentence.split(/\s+/);
        let wordChunk = "";
        for (const word of words) {
          const nextChunk = wordChunk ? `${wordChunk} ${word}` : word;
          if (this.estimateTokens(nextChunk) > this.chunkTargetMax && wordChunk) {
            chunks.push(wordChunk.trim());
            wordChunk = word;
          } else {
            wordChunk = nextChunk;
          }
        }
        if (wordChunk.trim()) chunks.push(wordChunk.trim());
        continue;
      }

      if (currentTokens + sentenceTokens > this.chunkTargetMax && current.trim()) {
        chunks.push(current.trim());
        current = sentence;
      } else {
        current = current ? `${current} ${sentence}` : sentence;
      }
    }

    if (current.trim()) chunks.push(current.trim());
    return chunks;
  }

  private tagChunks(
    rawChunks: string[],
    role: string,
    source: string,
    sessionId: string,
    timestamp: string | null
  ): NormalizedChunk[] {
    return rawChunks.map((text, index) => ({
      text,
      role,
      source,
      sessionId,
      timestamp,
      chunkIndex: index,
      tokenEstimate: this.estimateTokens(text),
    }));
  }

  private estimateTokens(text: string): number {
    if (!text) return 0;
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    let count = 0;
    for (const word of words) {
      count++;
      if (word.length > 6) count += Math.floor(word.length / 4);
      if (word.length > 12) count += 1;
    }
    return count;
  }
}

let normalizerInstance: TextNormalizer | null = null;

export function getNormalizer(): TextNormalizer {
  if (!normalizerInstance) {
    normalizerInstance = new TextNormalizer();
  }
  return normalizerInstance;
}