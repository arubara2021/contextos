import config from "../config";
import logger from "../utils/logger";
import {
  AIError,
  parseJsonArray,
  parseModelUri,
  sleep,
} from "./ai-provider";
import type {
  AIProvider,
  AITask,
  AIModelRef,
  AIChatRequest,
  AIChatResult,
  AIEmbeddingRequest,
  AIEmbeddingResult,
  AIHealthResult,
} from "./ai-provider";
import type { RawConceptFromAI } from "./bedrock-client";
import { getBedrockClient } from "./bedrock-client";
import { GoogleProvider } from "./google-provider";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";

export interface ModelConfig {
  modelId: string;
  displayName: string;
  maxTokens: number;
  provider: string;
}

export interface ModelRouteResult {
  response: string;
  modelUsed: string;
  durationMs: number;
}

export interface ModelRouterDeps {
  providers: Record<string, AIProvider>;
}

interface TaskAttempt extends AIModelRef { }

interface ErrorClassification {
  retryable: boolean;
  cooldownMs: number;
}

function parseRetryAfterMessage(message: string): number | null {
  const match =
    message.match(/retry in\s+([\d.]+)\s*s/i) ||
    message.match(/try again in\s+([\d.]+)\s*s/i) ||
    message.match(/after\s+([\d.]+)\s*s/i) ||
    message.match(/retry-after[:\s]+([\d.]+)/i);

  if (!match) return null;

  const seconds = Number(match[1]);

  if (!Number.isFinite(seconds)) return null;

  return Math.max(0, Math.ceil(seconds));
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

export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  private baseUrl: string;
  private chatModel: string;
  private embeddingModel: string;
  private timeoutMs: number;
  private dimension: number;

  constructor(options?: {
    baseUrl?: string;
    chatModel?: string;
    embeddingModel?: string;
    timeoutMs?: number;
    dimension?: number;
  }) {
    const providerConfig = (config.ai.providers as any).ollama ?? {};

    this.baseUrl = options?.baseUrl ?? providerConfig.baseUrl ?? "http://localhost:11434";
    this.chatModel = options?.chatModel ?? providerConfig.chatModel ?? "";
    this.embeddingModel =
      options?.embeddingModel ?? providerConfig.embeddingModel ?? "";
    this.timeoutMs =
      options?.timeoutMs ?? providerConfig.timeoutMs ?? config.ai.requestTimeoutMs;
    this.dimension =
      options?.dimension ?? providerConfig.embeddingDimensions ?? config.embedding.dimension;
  }

  supportsTask(task: AITask): boolean {
    const providerConfig = (config.ai.providers as any).ollama ?? {};

    if (!providerConfig.enabled) {
      return false;
    }

    if (task === "embedding") {
      return Boolean(this.embeddingModel);
    }

    return Boolean(this.chatModel);
  }

  async chat(request: AIChatRequest): Promise<AIChatResult> {
    const modelId = request.model?.modelId || this.chatModel;

    if (!modelId) {
      throw new AIError("Ollama chat model is not configured", {
        code: "OLLAMA_MODEL_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const start = Date.now();

    const data = await this.postJson<{ message?: { content?: string } }>(
      "/api/chat",
      {
        model: modelId,
        messages: [
          { role: "system", content: request.systemPrompt },
          { role: "user", content: request.userMessage },
        ],
        stream: false,
        options: {
          temperature: request.temperature ?? 0.7,
          num_predict: request.maxTokens ?? config.bedrock.maxTokens,
        },
      }
    );

    const text = data?.message?.content ?? "";

    if (!String(text).trim()) {
      throw new AIError("Ollama returned an empty response", {
        code: "OLLAMA_EMPTY_RESPONSE",
        provider: this.name,
        retryable: true,
      });
    }

    return {
      text: String(text),
      provider: this.name,
      modelUsed: modelId,
      durationMs: Date.now() - start,
    };
  }

  async structured<T>(request: AIChatRequest): Promise<T> {
    const result = await this.chat(request);
    return parseJsonArray<T>(result.text)[0] as T;
  }

  async embed(request: AIEmbeddingRequest): Promise<AIEmbeddingResult> {
    const modelId = request.model?.modelId || this.embeddingModel;

    if (!modelId) {
      throw new AIError("Ollama embedding model is not configured", {
        code: "OLLAMA_EMBEDDING_MODEL_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const start = Date.now();

    const data = await this.postJson<{ embeddings?: number[][] }>(
      "/api/embed",
      {
        model: modelId,
        input: request.text.trim(),
      }
    );

    const vector = data?.embeddings?.[0]?.map(Number) ?? [];

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new AIError("Ollama returned an invalid embedding", {
        code: "OLLAMA_BAD_EMBEDDING",
        provider: this.name,
        retryable: false,
      });
    }

    return {
      vector,
      provider: this.name,
      modelUsed: modelId,
      dimension: vector.length || this.dimension,
      durationMs: Date.now() - start,
    };
  }

  async healthCheck(request?: {
    model?: AIModelRef;
    task?: AITask;
  }): Promise<AIHealthResult> {
    const start = Date.now();

    try {
      if (request?.task === "embedding" && this.supportsTask("embedding")) {
        const result = await this.embed({
          text: "ContextOS health check",
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

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new AIError(`Ollama request failed: ${res.status}`, {
          code: "OLLAMA_HTTP_ERROR",
          provider: this.name,
          retryable: res.status >= 500 || res.status === 429,
        });
      }

      return (await res.json()) as T;
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        throw new AIError(`Ollama request timed out after ${this.timeoutMs}ms`, {
          code: "OLLAMA_TIMEOUT",
          provider: this.name,
          retryable: true,
        });
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class ModelRouter {
  private readonly providers: Record<string, AIProvider> = {};
  private readonly cooldownUntil = new Map<string, number>();

  constructor(deps?: ModelRouterDeps | AIProvider) {
    if (deps && "providers" in deps) {
      Object.assign(this.providers, deps.providers);
    } else if (deps) {
      this.providers.bedrock = deps;
    }

    this.ensureProviders();
    this.pruneDisabledProviders();
  }

  async send(
    systemPrompt: string,
    userMessage: string,
    _modelKey?: string
  ): Promise<ModelRouteResult> {
    const result = await this.routeChat("chat", systemPrompt, userMessage);

    return {
      response: result.text,
      modelUsed: result.modelUsed,
      durationMs: result.durationMs,
    };
  }

  async sendMessage(systemPrompt: string, userMessage: string): Promise<string> {
    const result = await this.routeChat("chat", systemPrompt, userMessage);
    return result.text;
  }

  async sendExtraction(
    systemPrompt: string,
    userMessage: string
  ): Promise<string> {
    const result = await this.routeChat(
      "extraction",
      systemPrompt,
      userMessage
    );

    return result.text;
  }

  async sendStream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (chunk: string) => void,
    _modelKey?: string
  ): Promise<ModelRouteResult> {
    const result = await this.routeChat("chat", systemPrompt, userMessage);

    onChunk(result.text);

    return {
      response: result.text,
      modelUsed: result.modelUsed,
      durationMs: result.durationMs,
    };
  }

  async generateStructured<T>(
    message: string,
    systemPrompt: string
  ): Promise<T> {
    return this.routeStructured<T>(systemPrompt, message);
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const result = await this.routeEmbedding(text);
    return result.vector;
  }

  async extractConcepts(text: string): Promise<RawConceptFromAI[]> {
    const response = await this.sendExtraction(
      "You extract structured concepts from text as JSON arrays. Output ONLY valid JSON.",
      text
    );

    return parseJsonArray<RawConceptFromAI>(response);
  }

  async classifyRelationship(
    labelA: string,
    defA: string,
    labelB: string,
    defB: string,
    context: string
  ): Promise<string> {
    const systemPrompt = [
      "Classify the relationship between two concepts.",
      'Valid types: "causes", "related_to", "replaces", "part_of", "requires", "evolves_into", "none".',
      "Output ONLY the relationship type as a single word.",
    ].join("\n");

    const userMessage = `Concept A: ${labelA} - ${defA}
Concept B: ${labelB} - ${defB}
Context: ${context}
Relationship type:`;

    const response = await this.sendMessage(systemPrompt, userMessage);

    return response.trim().toLowerCase().replace(/[^a-z_]/g, "");
  }

  async analyzeQuery(query: string): Promise<string> {
    const systemPrompt = [
      "You are a query analyzer. Given a user query, output a JSON object with:",
      '- "keyTerms": array of important terms',
      '- "intent": one of "recall", "compare", "build_on", "verify", "explore", "summarize", "debug", "explain"',
      '- "domain": general domain or field',
      '- "specificity": number 0-1',
      '- "preferredTypes": array of memory types',
      "Output ONLY valid JSON. No markdown, no explanation.",
    ].join("\n");

    return this.sendMessage(systemPrompt, query);
  }

  async summarize(text: string, maxLength: number = 200): Promise<string> {
    const response = await this.sendMessage(
      `Summarize the following text in ${maxLength} characters or less. Output only the summary.`,
      text
    );

    return response.trim().substring(0, maxLength);
  }

  async health(): Promise<{
    status: "healthy" | "degraded" | "unhealthy";
    defaultProvider: string;
    fallbackProviders: string[];
    embeddingDimension: number;
    latencyMs: number;
    models: Record<string, AIHealthResult & { modelId: string }>;
    errors: string[];
  }> {
    const start = Date.now();
    const tasks: Array<"chat" | "extraction" | "embedding"> = [
      "chat",
      "extraction",
      "embedding",
    ];

    const models: Record<string, AIHealthResult & { modelId: string }> = {};
    const errors: string[] = [];

    const checks = await Promise.allSettled(
      tasks.map(async (task) => {
        const attempts = this.getTaskAttempts(task);

        for (const model of attempts) {
          const provider = this.providers[model.provider];

          if (!provider || !provider.supportsTask(task)) {
            continue;
          }

          try {
            const result = await provider.healthCheck({ model, task });

            if (result.healthy) {
              return {
                task,
                result: {
                  ...result,
                  modelId: model.modelId,
                },
              };
            }

            if (result.error) {
              errors.push(`${task}:${model.provider}: ${result.error}`);
            }
          } catch (error) {
            errors.push(`${task}:${model.provider}: ${(error as Error).message}`);
          }
        }

        return {
          task,
          result: {
            provider: attempts[0]?.provider ?? config.ai.defaultProvider,
            healthy: false,
            latencyMs: 0,
            error: `No healthy provider for ${task}`,
            modelId: attempts[0]?.modelId ?? "",
          },
        };
      })
    );

    for (const check of checks) {
      if (check.status === "fulfilled") {
        models[check.value.task] = check.value.result;
      }
    }

    const healthyCount = Object.values(models).filter((m) => m.healthy).length;

    let status: "healthy" | "degraded" | "unhealthy" = "unhealthy";

    if (healthyCount === tasks.length) {
      status = "healthy";
    } else if (healthyCount > 0) {
      status = "degraded";
    }

    return {
      status,
      defaultProvider: config.ai.defaultProvider,
      fallbackProviders: config.ai.fallbackProviders,
      embeddingDimension: config.embedding.dimension,
      latencyMs: Date.now() - start,
      models,
      errors,
    };
  }

  getAvailableModels(): Array<{ key: string; config: ModelConfig }> {
    return [
      {
        key: "chat",
        config: {
          modelId: config.ai.models.chat,
          displayName: "AI Chat Model",
          maxTokens: config.bedrock.maxTokens,
          provider: parseModelUri(config.ai.models.chat).provider,
        },
      },
      {
        key: "extraction",
        config: {
          modelId: config.ai.models.extraction,
          displayName: "AI Extraction Model",
          maxTokens: config.extraction.maxTokens,
          provider: parseModelUri(config.ai.models.extraction).provider,
        },
      },
      {
        key: "embedding",
        config: {
          modelId: config.ai.models.embedding,
          displayName: "AI Embedding Model",
          maxTokens: 0,
          provider: parseModelUri(config.ai.models.embedding).provider,
        },
      },
    ];
  }

  getDefaultModel(): string {
    return config.ai.defaultProvider;
  }

  getModelConfig(modelKey: string): ModelConfig | null {
    const found = this.getAvailableModels().find((m) => m.key === modelKey);
    return found?.config ?? null;
  }

  hasModel(modelKey: string): boolean {
    return this.getAvailableModels().some((m) => m.key === modelKey);
  }

  private ensureProviders(): void {
    const providers = config.ai.providers as any;

    if (!this.providers.bedrock && providers.bedrock?.enabled) {
      this.providers.bedrock = getBedrockClient();
    }

    if (!this.providers.google && providers.google?.enabled) {
      this.providers.google = new GoogleProvider({
        name: "google",
        ...providers.google,
      });
    }

    const openaiCompatibleNames = ["groq", "sambanova", "mistral", "nvidia"];

    for (const name of openaiCompatibleNames) {
      const definition = providers[name];

      if (!this.providers[name] && definition?.enabled) {
        this.providers[name] = new OpenAICompatibleProvider({
          name,
          ...definition,
        });
      }
    }

    if (!this.providers.ollama && providers.ollama?.enabled) {
      this.providers.ollama = new OllamaProvider({
        baseUrl: providers.ollama.baseUrl,
        chatModel: providers.ollama.chatModel,
        embeddingModel: providers.ollama.embeddingModel,
        timeoutMs: providers.ollama.timeoutMs,
        dimension: providers.ollama.embeddingDimensions,
      });
    }
  }

  private pruneDisabledProviders(): void {
    const providers = config.ai.providers as any;

    for (const name of Object.keys(this.providers)) {
      const definition = providers[name];

      if (definition && definition.enabled === false) {
        delete this.providers[name];
      }
    }
  }

  private async routeChat(
    task: "chat" | "extraction",
    systemPrompt: string,
    userMessage: string
  ): Promise<AIChatResult> {
    const attempts = this.getTaskAttempts(task);
    let available = this.availableAttempts(attempts, task);

    if (available.length === 0) {
      const wait = this.soonestCooldownMs();
      if (wait > 0 && wait <= 20000) {
        await sleep(wait + 100);
        this.clearExpiredCooldowns();
        available = this.availableAttempts(attempts, task);
      }
    }

    if (available.length === 0) {
      throw new AIError("All AI providers are cooling down", {
        code: "AI_ALL_COOLDOWN",
        task,
        retryable: true,
      });
    }

    let lastError: Error | null = null;

    for (const model of available) {
      const provider = this.providers[model.provider];

      if (!provider || !provider.supportsTask(task)) {
        continue;
      }

      try {
        return await provider.chat({
          systemPrompt,
          userMessage,
          model,
          maxTokens:
            task === "extraction"
              ? config.extraction.maxTokens
              : config.bedrock.maxTokens,
          temperature:
            task === "extraction" ? config.extraction.temperature : 0.7,
        });
      } catch (error) {
        lastError = error as Error;

        const classification = this.classifyError(error);

        if (classification.cooldownMs > 0) {
          this.setCooldown(model.provider, classification.cooldownMs);
        }

        logger.warn("AI chat route failed", {
          task,
          provider: model.provider,
          modelId: model.modelId,
          retryable: classification.retryable,
          cooldownMs: classification.cooldownMs,
          error: lastError.message,
        });
      }
    }

    throw (
      lastError ??
      new AIError("All AI providers failed for chat task", {
        code: "AI_ROUTE_FAILED",
        task,
        retryable: false,
      })
    );
  }

  private async routeStructured<T>(
    systemPrompt: string,
    userMessage: string
  ): Promise<T> {
    const attempts = this.getTaskAttempts("structured");
    let available = this.availableAttempts(attempts, "structured");

    if (available.length === 0) {
      const wait = this.soonestCooldownMs();
      if (wait > 0 && wait <= 20000) {
        await sleep(wait + 100);
        this.clearExpiredCooldowns();
        available = this.availableAttempts(attempts, "structured");
      }
    }

    if (available.length === 0) {
      throw new AIError("All AI providers are cooling down", {
        code: "AI_ALL_COOLDOWN",
        task: "structured",
        retryable: true,
      });
    }

    let lastError: Error | null = null;

    for (const model of available) {
      const provider = this.providers[model.provider];

      if (!provider || !provider.supportsTask("structured")) {
        continue;
      }

      try {
        return await provider.structured<T>({
          systemPrompt,
          userMessage,
          model,
          maxTokens: config.extraction.maxTokens,
          temperature: config.extraction.temperature,
        });
      } catch (error) {
        lastError = error as Error;

        const classification = this.classifyError(error);

        if (classification.cooldownMs > 0) {
          this.setCooldown(model.provider, classification.cooldownMs);
        }

        logger.warn("AI structured route failed", {
          provider: model.provider,
          modelId: model.modelId,
          retryable: classification.retryable,
          cooldownMs: classification.cooldownMs,
          error: lastError.message,
        });
      }
    }

    throw (
      lastError ??
      new AIError("All AI providers failed for structured task", {
        code: "AI_STRUCTURED_ROUTE_FAILED",
        task: "structured",
        retryable: false,
      })
    );
  }

  private async routeEmbedding(text: string): Promise<AIEmbeddingResult> {
    const attempts = this.getTaskAttempts("embedding");
    let available = this.availableAttempts(attempts, "embedding");

    if (available.length === 0) {
      const wait = this.soonestCooldownMs();
      if (wait > 0 && wait <= 20000) {
        await sleep(wait + 100);
        this.clearExpiredCooldowns();
        available = this.availableAttempts(attempts, "embedding");
      }
    }

    if (available.length === 0) {
      throw new AIError("All embedding providers are cooling down", {
        code: "AI_EMBEDDING_ALL_COOLDOWN",
        task: "embedding",
        retryable: true,
      });
    }

    let lastError: Error | null = null;

    for (const model of available) {
      const provider = this.providers[model.provider];

      if (!provider || !provider.supportsTask("embedding")) {
        continue;
      }

      try {
        return await provider.embed({ text, model });
      } catch (error) {
        lastError = error as Error;

        const classification = this.classifyError(error);

        if (classification.cooldownMs > 0) {
          this.setCooldown(model.provider, classification.cooldownMs);
        }

        logger.warn("AI embedding route failed", {
          provider: model.provider,
          modelId: model.modelId,
          retryable: classification.retryable,
          cooldownMs: classification.cooldownMs,
          error: lastError.message,
        });
      }
    }

    throw (
      lastError ??
      new AIError("All AI providers failed for embedding task", {
        code: "AI_EMBEDDING_ROUTE_FAILED",
        task: "embedding",
        retryable: false,
      })
    );
  }

  private getTaskAttempts(task: AITask): TaskAttempt[] {
    const attempts: TaskAttempt[] = [];
    const seen = new Set<string>();

    const addModel = (model?: AIModelRef | null) => {
      if (!model || !model.modelId) return;

      const provider = this.providers[model.provider];

      if (!provider) return;

      if (!provider.supportsTask(task)) return;

      const key = `${model.provider}:${model.modelId}`;

      if (seen.has(key)) return;

      seen.add(key);
      attempts.push(model);
    };

    addModel(this.resolveTaskModel(task));
    addModel(this.getModelForProvider(config.ai.defaultProvider, task));

    for (const provider of config.ai.fallbackProviders) {
      addModel(this.getModelForProvider(provider, task));
    }

    for (const provider of Object.keys(this.providers)) {
      addModel(this.getModelForProvider(provider, task));
    }

    return attempts;
  }

  private availableAttempts(
    attempts: TaskAttempt[],
    task: AITask
  ): TaskAttempt[] {
    return attempts.filter((model) => {
      const provider = this.providers[model.provider];
      if (!provider || !provider.supportsTask(task)) {
        return false;
      }
      return !this.isCoolingDown(model.provider);
    });
  }

  private resolveTaskModel(task: AITask): AIModelRef {
    if (task === "embedding") {
      return parseModelUri(config.ai.models.embedding, config.ai.defaultProvider);
    }

    if (task === "extraction" || task === "structured") {
      return parseModelUri(
        config.ai.models.extraction,
        config.ai.defaultProvider
      );
    }

    return parseModelUri(config.ai.models.chat, config.ai.defaultProvider);
  }

  private getModelForProvider(
    provider: string,
    task: AITask
  ): AIModelRef | null {
    if (provider === "bedrock") {
      const bedrock = (config.ai.providers as any).bedrock ?? {};

      if (task === "embedding") {
        if (!bedrock.embeddingModelId) return null;

        return {
          provider: "bedrock",
          modelId: bedrock.embeddingModelId,
          region: bedrock.region,
          dimensions: bedrock.embeddingDimensions ?? config.embedding.dimension,
        };
      }

      if (task === "extraction" || task === "structured") {
        const modelId = bedrock.extractionModelId || bedrock.modelId;

        if (!modelId) return null;

        return {
          provider: "bedrock",
          modelId,
          region: bedrock.region,
        };
      }

      if (!bedrock.modelId) return null;

      return {
        provider: "bedrock",
        modelId: bedrock.modelId,
        region: bedrock.region,
      };
    }

    const definition = (config.ai.providers as any)[provider];

    if (!definition) return null;

    if (task === "embedding") {
      if (!definition.supportsEmbeddings || !definition.embeddingModel) {
        return null;
      }

      return {
        provider,
        modelId: definition.embeddingModel,
        endpoint: definition.baseUrl,
        dimensions: definition.embeddingDimensions,
      };
    }

    if (task === "extraction" || task === "structured") {
      const modelId = definition.extractionModel || definition.chatModel;

      if (!modelId) return null;

      return {
        provider,
        modelId,
        endpoint: definition.baseUrl,
      };
    }

    if (!definition.chatModel) return null;

    return {
      provider,
      modelId: definition.chatModel,
      endpoint: definition.baseUrl,
    };
  }

  private classifyError(error: unknown): ErrorClassification {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const lower = message.toLowerCase();

    const retryAfter = parseRetryAfterMessage(message);

    if (retryAfter !== null) {
      return {
        retryable: true,
        cooldownMs: retryAfter * 1000,
      };
    }

    if (
      lower.includes("quota") ||
      lower.includes("rate limit") ||
      lower.includes("429") ||
      lower.includes("too many")
    ) {
      return {
        retryable: true,
        cooldownMs: config.ai.providerCooldownMs,
      };
    }

    if (lower.includes("request too large") || lower.includes("too large")) {
      return {
        retryable: false,
        cooldownMs: 0,
      };
    }

    if (lower.includes("empty response")) {
      return {
        retryable: true,
        cooldownMs: 2000,
      };
    }

    if (
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("connection") ||
      lower.includes("network") ||
      lower.includes("socket") ||
      lower.includes("abort") ||
      lower.includes("econnreset") ||
      lower.includes("etimedout") ||
      lower.includes("500") ||
      lower.includes("502") ||
      lower.includes("503") ||
      lower.includes("504")
    ) {
      return {
        retryable: true,
        cooldownMs: 1000,
      };
    }

    if (error instanceof AIError) {
      return {
        retryable: error.retryable,
        cooldownMs: error.retryable ? 1000 : 0,
      };
    }

    const retryable = isRetryableMessage(message);

    return {
      retryable,
      cooldownMs: retryable ? 1000 : 0,
    };
  }

  private isCoolingDown(provider: string): boolean {
    const until = this.cooldownUntil.get(provider) ?? 0;
    return Date.now() < until;
  }

  private setCooldown(provider: string, ms: number): void {
    const until = Date.now() + ms;
    const existing = this.cooldownUntil.get(provider) ?? 0;

    if (until > existing) {
      this.cooldownUntil.set(provider, until);
    }
  }

  private soonestCooldownMs(): number {
    const now = Date.now();
    let soonest = Infinity;

    for (const until of this.cooldownUntil.values()) {
      if (until > now && until < soonest) {
        soonest = until;
      }
    }

    if (soonest === Infinity) return 0;

    return soonest - now;
  }

  private clearExpiredCooldowns(): void {
    const now = Date.now();

    for (const [provider, until] of this.cooldownUntil.entries()) {
      if (until <= now) {
        this.cooldownUntil.delete(provider);
      }
    }
  }
}

let modelRouterInstance: ModelRouter | null = null;

export function getModelRouter(
  deps?: ModelRouterDeps | AIProvider
): ModelRouter {
  if (!modelRouterInstance) {
    modelRouterInstance = new ModelRouter(deps);
  }

  return modelRouterInstance;
}