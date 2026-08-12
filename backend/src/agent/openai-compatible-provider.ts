import { AIError, parseJsonAny, sleep } from "./ai-provider";
import type {
  AIChatRequest,
  AIChatResult,
  AIEmbeddingRequest,
  AIEmbeddingResult,
  AIHealthCheckRequest,
  AIHealthResult,
  AIModelRef,
  AIProvider,
  AITask,
} from "./ai-provider";

const fetchFn = (globalThis as any).fetch;

export interface CloudProviderDefinition {
  name: string;
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  extractionModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  supportsJsonMode: boolean;
  supportsEmbeddings: boolean;
  extraHeaders?: Record<string, string>;
}

function parseRetryAfterHeader(value: string | null): number | null {
  if (!value) return null;

  const trimmed = value.trim();

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : null;
  }

  const dateMs = Date.parse(trimmed);

  if (!Number.isNaN(dateMs)) {
    const delta = Math.ceil((dateMs - Date.now()) / 1000);
    return delta > 0 ? delta : 0;
  }

  return null;
}

function parseRetryAfterMessage(message: string): number | null {
  const match =
    message.match(/retry in\s+([\d.]+)\s*s/i) ||
    message.match(/try again in\s+([\d.]+)\s*s/i) ||
    message.match(/after\s+([\d.]+)\s*s/i) ||
    message.match(/retry-after[:\s]+([\d.]+)/i);

  if (!match) return null;

  const seconds = Number(match[1]);

  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : null;
}

function getRetryAfterFromError(error: unknown): number | null {
  const message =
    error instanceof Error ? error.message : String(error ?? "");

  return parseRetryAfterMessage(message);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryableMessage(message: string): boolean {
  const lower = message.toLowerCase();

  return (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("throttl") ||
    lower.includes("rate") ||
    lower.includes("quota") ||
    lower.includes("429") ||
    lower.includes("500") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504") ||
    lower.includes("connection") ||
    lower.includes("network") ||
    lower.includes("socket") ||
    lower.includes("abort") ||
    lower.includes("econnreset") ||
    lower.includes("etimedout")
  );
}

function validateVector(vector: number[], expectedDimension: number): void {
  if (!Array.isArray(vector)) {
    throw new AIError("Embedding is not an array", {
      code: "EMBEDDING_INVALID",
      retryable: false,
    });
  }

  if (expectedDimension > 0 && vector.length !== expectedDimension) {
    throw new AIError(
      `Embedding dimension mismatch: expected ${expectedDimension}, got ${vector.length}`,
      {
        code: "EMBEDDING_DIMENSION_MISMATCH",
        retryable: false,
      }
    );
  }

  if (!vector.every((value) => Number.isFinite(value))) {
    throw new AIError("Embedding contains non-finite values", {
      code: "EMBEDDING_INVALID",
      retryable: false,
    });
  }

  if (!vector.some((value) => value !== 0)) {
    throw new AIError("Embedding is all zeros", {
      code: "EMBEDDING_INVALID",
      retryable: false,
    });
  }
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;
  private readonly definition: CloudProviderDefinition;

  constructor(definition: CloudProviderDefinition) {
    this.name = definition.name || "openai-compatible";
    this.definition = definition;
  }

  supportsTask(task: AITask): boolean {
    if (task === "embedding") {
      return (
        this.definition.supportsEmbeddings &&
        this.definition.embeddingModel.trim().length > 0
      );
    }

    if (task === "extraction" || task === "structured") {
      return (
        this.definition.extractionModel.trim().length > 0 ||
        this.definition.chatModel.trim().length > 0
      );
    }

    return this.definition.chatModel.trim().length > 0;
  }

  async chat(request: AIChatRequest): Promise<AIChatResult> {
    return this.withRetry(
      () => this.chatInternal(request, false, false),
      "chat"
    );
  }

  async structured<T>(request: AIChatRequest): Promise<T> {
    if (this.definition.supportsJsonMode) {
      try {
        const result = await this.withRetry(
          () => this.chatInternal(request, true, true),
          "structured-json"
        );

        return parseJsonAny<T>(result.text);
      } catch (error) {
        if (error instanceof AIError && error.retryable) {
          throw error;
        }
      }
    }

    const result = await this.withRetry(
      () => this.chatInternal(request, false, true),
      "structured"
    );

    return parseJsonAny<T>(result.text);
  }

  async embed(request: AIEmbeddingRequest): Promise<AIEmbeddingResult> {
    return this.withRetry(() => this.embedInternal(request), "embedding");
  }

  async healthCheck(request?: AIHealthCheckRequest): Promise<AIHealthResult> {
    const start = Date.now();

    try {
      if (request?.task === "embedding" && this.supportsTask("embedding")) {
        const result = await this.embed({
          text: "ContextOS provider health check",
          model: request.model,
        });

        return {
          provider: this.name,
          healthy: true,
          latencyMs: Date.now() - start,
          details: {
            modelUsed: result.modelUsed,
            dimension: result.dimension,
          },
        };
      }

      const result = await this.chat({
        systemPrompt: "Health check",
        userMessage: "Reply with ok",
        model: request?.model,
        maxTokens: 8,
        temperature: 0,
      });

      return {
        provider: this.name,
        healthy: true,
        latencyMs: Date.now() - start,
        details: {
          modelUsed: result.modelUsed,
        },
      };
    } catch (error) {
      return {
        provider: this.name,
        healthy: false,
        latencyMs: Date.now() - start,
        error: (error as Error).message,
      };
    }
  }

  private get timeoutMs(): number {
    const value = Number(this.definition.timeoutMs);
    return Number.isFinite(value) && value > 0 ? value : 90000;
  }

  private get maxRetries(): number {
    const value = Number(this.definition.maxRetries);
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 1;
  }

  private get retryDelayMs(): number {
    const value = Number(this.definition.retryDelayMs);
    return Number.isFinite(value) && value > 0 ? value : 700;
  }

  private baseUrl(): string {
    return this.definition.baseUrl.replace(/\/+$/, "");
  }

  private ensureApiKey(): string {
    const apiKey = this.definition.apiKey?.trim();

    if (!apiKey) {
      throw new AIError(`${this.name} API key is not configured`, {
        code: "OPENAI_COMPATIBLE_API_KEY_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    return apiKey;
  }

  private normalizeModelId(modelId: string): string {
    let value = modelId.trim();

    const schemeIndex = value.indexOf("://");

    if (schemeIndex !== -1) {
      value = value.slice(schemeIndex + 3);
    }

    const queryIndex = value.indexOf("?");

    if (queryIndex !== -1) {
      value = value.slice(0, queryIndex);
    }

    if (value.startsWith("models/")) {
      value = value.slice(7);
    }

    return value;
  }

  private resolveChatModel(
    request: AIChatRequest,
    useExtractionModel: boolean
  ): string {
    const requested = request.model?.modelId?.trim();

    if (requested) {
      return this.normalizeModelId(requested);
    }

    if (useExtractionModel && this.definition.extractionModel.trim()) {
      return this.normalizeModelId(this.definition.extractionModel);
    }

    return this.normalizeModelId(this.definition.chatModel);
  }

  private resolveEmbeddingModel(request: AIEmbeddingRequest): string {
    const requested = request.model?.modelId?.trim();

    if (requested) {
      return this.normalizeModelId(requested);
    }

    return this.normalizeModelId(this.definition.embeddingModel);
  }

  private resolveEmbeddingDimension(request: AIEmbeddingRequest): number {
    const fromModel = Number(request.model?.dimensions);

    if (Number.isFinite(fromModel) && fromModel > 0) {
      return Math.floor(fromModel);
    }

    const fromDefinition = Number(this.definition.embeddingDimensions);

    if (Number.isFinite(fromDefinition) && fromDefinition > 0) {
      return Math.floor(fromDefinition);
    }

    return 0;
  }

  private capMaxTokens(requested: number | undefined): number {
    const fallback = this.name === "groq" ? 3072 : 4096;
    const value =
      typeof requested === "number" && requested > 0 ? requested : fallback;

    return Math.min(Math.floor(value), fallback);
  }

  private async chatInternal(
    request: AIChatRequest,
    jsonMode: boolean,
    useExtractionModel: boolean
  ): Promise<AIChatResult> {
    const modelId = this.resolveChatModel(request, useExtractionModel);

    if (!modelId) {
      throw new AIError(`${this.name} chat model is not configured`, {
        code: "OPENAI_COMPATIBLE_MODEL_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const start = Date.now();

    const body: Record<string, unknown> = {
      model: modelId,
      stream: false,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userMessage },
      ],
      max_tokens: this.capMaxTokens(request.maxTokens),
      temperature:
        typeof request.temperature === "number" ? request.temperature : 0.7,
    };

    if (jsonMode && this.definition.supportsJsonMode) {
      body.response_format = { type: "json_object" };
    }

    const json = await this.postJson("/chat/completions", body, "chat");

    if (json?.error?.message && !json?.choices) {
      throw new AIError(String(json.error.message), {
        code: "OPENAI_COMPATIBLE_API_ERROR",
        provider: this.name,
        task: "chat",
        retryable: isRetryableMessage(String(json.error.message)),
      });
    }

    const choice = json?.choices?.[0];

    if (choice?.finish_reason === "content_filter") {
      throw new AIError(`${this.name} response blocked by content filter`, {
        code: "OPENAI_COMPATIBLE_CONTENT_FILTER",
        provider: this.name,
        retryable: false,
      });
    }

    const rawContent =
      choice?.message?.content ??
      choice?.text ??
      json?.message?.content ??
      json?.text ??
      "";

    const text = Array.isArray(rawContent)
      ? rawContent
          .map((block: any) =>
            typeof block === "string" ? block : block?.text ?? ""
          )
          .join("")
      : String(rawContent ?? "");

    const trimmed = text.trim();

    if (!trimmed) {
      throw new AIError(`${this.name} returned an empty response`, {
        code: "OPENAI_COMPATIBLE_EMPTY_RESPONSE",
        provider: this.name,
        retryable: true,
      });
    }

    return {
      text: trimmed,
      provider: this.name,
      modelUsed: modelId,
      durationMs: Date.now() - start,
    };
  }

  private async embedInternal(
    request: AIEmbeddingRequest
  ): Promise<AIEmbeddingResult> {
    if (!this.supportsTask("embedding")) {
      throw new AIError(`${this.name} embeddings are not configured`, {
        code: "OPENAI_COMPATIBLE_EMBEDDING_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const modelId = this.resolveEmbeddingModel(request);

    if (!modelId) {
      throw new AIError(`${this.name} embedding model is not configured`, {
        code: "OPENAI_COMPATIBLE_EMBEDDING_MODEL_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const text = request.text.trim();

    if (!text) {
      throw new AIError("Cannot embed empty text", {
        code: "OPENAI_COMPATIBLE_EMBEDDING_EMPTY_TEXT",
        provider: this.name,
        retryable: false,
      });
    }

    const start = Date.now();

    const json = await this.postJson(
      "/embeddings",
      {
        model: modelId,
        input: text.substring(0, 20000),
      },
      "embedding"
    );

    if (json?.error?.message && !json?.data && !json?.embeddings) {
      throw new AIError(String(json.error.message), {
        code: "OPENAI_COMPATIBLE_EMBEDDING_API_ERROR",
        provider: this.name,
        task: "embedding",
        retryable: isRetryableMessage(String(json.error.message)),
      });
    }

    const vector =
      json?.data?.[0]?.embedding ??
      json?.embedding ??
      json?.embeddings?.[0]?.embedding ??
      json?.embeddings?.[0] ??
      null;

    if (!Array.isArray(vector)) {
      throw new AIError(
        `${this.name} returned an invalid embedding response`,
        {
          code: "OPENAI_COMPATIBLE_BAD_EMBEDDING_RESPONSE",
          provider: this.name,
          retryable: false,
        }
      );
    }

    const numericVector = vector.map(Number);
    const expectedDimension = this.resolveEmbeddingDimension(request);

    validateVector(numericVector, expectedDimension);

    return {
      vector: numericVector,
      provider: this.name,
      modelUsed: modelId,
      dimension: numericVector.length,
      durationMs: Date.now() - start,
    };
  }

  private async postJson(
    path: string,
    body: unknown,
    taskName: string
  ): Promise<any> {
    if (typeof fetchFn !== "function") {
      throw new AIError("Global fetch is not available", {
        code: "FETCH_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const apiKey = this.ensureApiKey();
    const url = `${this.baseUrl()}${path}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(this.definition.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const headers = (response as any).headers;
      const retryAfterHeader = headers?.get
        ? headers.get("retry-after")
        : null;

      const rawText = await response.text();

      let json: any = null;

      if (rawText) {
        try {
          json = JSON.parse(rawText);
        } catch {
          json = null;
        }
      }

      if (!response.ok) {
        const baseMessage =
          json?.error?.message ||
          json?.message ||
          json?.detail ||
          rawText ||
          `HTTP ${response.status}`;

        const retryAfterSeconds =
          parseRetryAfterHeader(retryAfterHeader) ??
          parseRetryAfterMessage(baseMessage);

        const message = retryAfterSeconds
          ? `${baseMessage} | retry-after:${retryAfterSeconds}s`
          : baseMessage;

        let retryable = isRetryableStatus(response.status);

        if (/quota|rate|limit|exceeded/i.test(message)) {
          retryable = true;
        }

        if (/request too large|too large|token/i.test(message)) {
          retryable = false;
        }

        throw new AIError(message, {
          code: "OPENAI_COMPATIBLE_HTTP_ERROR",
          provider: this.name,
          task: taskName,
          retryable,
        });
      }

      return json;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new AIError(
          `${this.name} request timed out after ${this.timeoutMs}ms`,
          {
            code: "OPENAI_COMPATIBLE_TIMEOUT",
            provider: this.name,
            task: taskName,
            retryable: true,
          }
        );
      }

      if (error instanceof AIError) {
        throw error;
      }

      throw new AIError((error as Error).message, {
        code: "OPENAI_COMPATIBLE_REQUEST_FAILED",
        provider: this.name,
        task: taskName,
        retryable: isRetryableMessage((error as Error).message),
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async withRetry<T>(
    task: () => Promise<T>,
    taskName: string
  ): Promise<T> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await task();
      } catch (error) {
        lastError = error;

        const retryable =
          error instanceof AIError
            ? error.retryable
            : isRetryableMessage((error as Error).message);

        if (!retryable || attempt >= this.maxRetries) {
          break;
        }

        const retryAfterSeconds = getRetryAfterFromError(error);

        if (retryAfterSeconds !== null && retryAfterSeconds > 10) {
          break;
        }

        const delayMs =
          retryAfterSeconds !== null
            ? retryAfterSeconds * 1000
            : this.retryDelayMs * Math.pow(2, attempt);

        await sleep(delayMs);
      }
    }

    if (lastError instanceof Error) {
      throw lastError;
    }

    throw new AIError(`${this.name} request failed`, {
      code: "OPENAI_COMPATIBLE_RETRY_FAILED",
      provider: this.name,
      task: taskName,
      retryable: false,
    });
  }
}