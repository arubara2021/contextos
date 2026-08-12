import config from "../config";
import logger from "../utils/logger";
import { AIError } from "../agent/ai-provider";

export interface EmbeddingClient {
  generateEmbedding(text: string): Promise<number[]>;
  getEmbeddingDimension?: () => number;
}

export class EmbeddingGenerator {
  private readonly client: EmbeddingClient;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly concurrency: number;
  private readonly maxTextLength: number;
  private readonly configuredDimension: number;
  private readonly embeddingCache: Map<
    string,
    { vector: number[]; timestamp: number }
  > = new Map();
  private readonly cacheTtlMs = 30 * 60 * 1000;
  private readonly maxCacheSize = 500;

  constructor(embeddingClient: EmbeddingClient) {
    this.client = embeddingClient;
    this.maxRetries = 2;
    this.retryDelayMs = 500;
    this.concurrency = config.embedding.concurrency;
    this.maxTextLength = config.embedding.textMaxLength;
    this.configuredDimension = config.embedding.dimension;
  }

  async generate(text: string): Promise<number[]> {
    if (!text || !text.trim()) {
      throw new AIError("Cannot generate embedding for empty text", {
        code: "EMBEDDING_EMPTY_TEXT",
        task: "embedding",
        retryable: false,
      });
    }

    const cleaned = this.preprocessText(text);

    const cached = this.embeddingCache.get(cleaned);
    if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
      if (this.validateEmbedding(cached.vector)) {
        return cached.vector;
      }
      this.embeddingCache.delete(cleaned);
    }

    const vector = await this.generateWithRetry(cleaned);

    this.evictOldestCacheEntry();
    this.embeddingCache.set(cleaned, { vector, timestamp: Date.now() });

    return vector;
  }

  async generateForConcept(
    label: string,
    definition: string,
    significance?: string
  ): Promise<number[]> {
    let text = `${label}: ${definition}`;

    if (significance && significance.trim().length > 0) {
      text += ` SIGNIFICANCE: ${significance}`;
    }

    return this.generate(text);
  }

  async generateForQuery(query: string): Promise<number[]> {
    return this.generate(query);
  }

  async generateBatch(texts: string[]): Promise<Array<number[] | null>> {
    if (texts.length === 0) return [];

    const results: Array<number[] | null> = new Array(texts.length).fill(null);
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    let cachedCount = 0;

    for (let i = 0; i < texts.length; i++) {
      if (!texts[i] || !texts[i].trim()) {
        results[i] = null;
        continue;
      }

      const cleaned = this.preprocessText(texts[i]);
      const cached = this.embeddingCache.get(cleaned);

      if (cached && Date.now() - cached.timestamp < this.cacheTtlMs) {
        if (this.validateEmbedding(cached.vector)) {
          results[i] = cached.vector;
          cachedCount++;
          continue;
        }
        this.embeddingCache.delete(cleaned);
      }

      uncachedIndices.push(i);
      uncachedTexts.push(cleaned);
    }

    let generatedCount = 0;

    if (uncachedTexts.length > 0) {
      for (let i = 0; i < uncachedTexts.length; i += this.concurrency) {
        const batch = uncachedTexts.slice(i, i + this.concurrency);
        const batchIndices = uncachedIndices.slice(i, i + this.concurrency);

        const batchResults = await Promise.allSettled(
          batch.map((text) => this.generateWithRetry(text))
        );

        for (let j = 0; j < batchResults.length; j++) {
          const result = batchResults[j];
          const originalIndex = batchIndices[j];

          if (result.status === "fulfilled" && result.value) {
            results[originalIndex] = result.value;
            generatedCount++;

            this.evictOldestCacheEntry();
            this.embeddingCache.set(batch[j], {
              vector: result.value,
              timestamp: Date.now(),
            });
          } else {
            logger.debug("Embedding failed in batch", {
              index: originalIndex,
              error:
                result.status === "rejected"
                  ? result.reason?.message
                  : "null result",
            });
          }
        }
      }
    }

    const successCount = results.filter((r) => r !== null).length;

    logger.debug("Batch embedding complete", {
      total: texts.length,
      cached: cachedCount,
      generated: generatedCount,
      success: successCount,
    });

    return results;
  }

  validateEmbedding(embedding: number[]): boolean {
    if (!Array.isArray(embedding)) return false;

    const dimension = this.resolveDimension();

    if (embedding.length !== dimension) return false;
    if (!embedding.every((v) => Number.isFinite(v))) return false;

    return embedding.some((v) => v !== 0);
  }

  getCacheStats(): { size: number; hitRate: number } {
    return { size: this.embeddingCache.size, hitRate: 0 };
  }

  private resolveDimension(): number {
    if (typeof this.client.getEmbeddingDimension === "function") {
      const dynamicDimension = this.client.getEmbeddingDimension();
      if (Number.isFinite(dynamicDimension) && dynamicDimension > 0) {
        return dynamicDimension;
      }
    }

    return this.configuredDimension;
  }

  private evictOldestCacheEntry(): void {
    if (this.embeddingCache.size >= this.maxCacheSize) {
      const oldestKey = this.embeddingCache.keys().next()
        .value as string | undefined;

      if (oldestKey !== undefined) {
        this.embeddingCache.delete(oldestKey);
      }
    }
  }

  private preprocessText(text: string): string {
    let result = text.trim();
    result = result.replace(/\s+/g, " ");

    if (result.length > this.maxTextLength) {
      result = result.substring(0, this.maxTextLength);

      const lastPeriod = result.lastIndexOf(".");
      const lastSpace = result.lastIndexOf(" ");
      const cutPoint = Math.max(lastPeriod, lastSpace);

      if (cutPoint > this.maxTextLength * 0.5) {
        result = result.substring(0, cutPoint + 1);
      }
    }

    return result;
  }

  private async generateWithRetry(text: string): Promise<number[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const embedding = await this.client.generateEmbedding(text);

        if (!this.validateEmbedding(embedding)) {
          throw new AIError(
            `Invalid embedding: expected ${this.resolveDimension()} dimensions and finite non-zero values`,
            {
              code: "EMBEDDING_INVALID",
              task: "embedding",
              retryable: false,
            }
          );
        }

        return embedding;
      } catch (error) {
        lastError = error as Error;

        let retryable = false;

        if (error instanceof AIError) {
          retryable = error.retryable;
        } else {
          const msg = lastError.message.toLowerCase();
          retryable =
            msg.includes("timeout") ||
            msg.includes("timed out") ||
            msg.includes("throttl") ||
            msg.includes("rate") ||
            msg.includes("429") ||
            msg.includes("503") ||
            msg.includes("500") ||
            msg.includes("connection") ||
            msg.includes("network");
        }

        if (!retryable || attempt >= this.maxRetries) break;

        const delay = this.retryDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw (
      lastError ||
      new AIError("Embedding generation failed", {
        code: "EMBEDDING_GENERATION_FAILED",
        task: "embedding",
        retryable: false,
      })
    );
  }
}

let generatorInstance: EmbeddingGenerator | null = null;

export function getEmbeddingGenerator(
  client: EmbeddingClient
): EmbeddingGenerator {
  if (!generatorInstance) {
    generatorInstance = new EmbeddingGenerator(client);
  }
  return generatorInstance;
}