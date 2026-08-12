import config from "../config";
import logger from "../utils/logger";
import {
  AIChatRequest,
  AIChatResult,
  AIEmbeddingRequest,
  AIEmbeddingResult,
  AIError,
  AIHealthCheckRequest,
  AIHealthResult,
  AIModelRef,
  AIProvider,
  AITask,
  parseJsonAny,
  parseJsonArray,
  parseModelUri,
  sleep,
  validateEmbeddingVector,
} from "./ai-provider";

export interface RawConceptFromAI {
  label?: unknown;
  definition?: unknown;
  significance?: unknown;
  type?: unknown;
  importance?: unknown;
  related?: unknown;
}

export class BedrockClient implements AIProvider {
  readonly name = "bedrock";

  private clients = new Map<string, any>();
  private sdk: any | null = null;
  private InvokeModelCommand: any;
  private InvokeModelWithResponseStreamCommand: any;

  constructor() {
    const hasCreds = this.hasCredentials();

    if (hasCreds) {
      const sdk = require("@aws-sdk/client-bedrock-runtime");
      this.sdk = sdk;
      this.InvokeModelCommand = sdk.InvokeModelCommand;
      this.InvokeModelWithResponseStreamCommand =
        sdk.InvokeModelWithResponseStreamCommand;

      logger.info("BedrockClient initialized in AWS mode", {
        chatModel: config.ai.models.chat,
        extractionModel: config.ai.models.extraction,
        embeddingModel: config.ai.models.embedding,
      });
    } else {
      logger.warn("BedrockClient initialized without AWS credentials");
    }
  }

  supportsTask(task: AITask): boolean {
    if (!this.hasCredentials()) {
      return false;
    }

    if (task === "embedding") {
      return Boolean(this.defaultEmbeddingModel().modelId);
    }

    return Boolean(this.defaultChatModel().modelId);
  }

  async chat(request: AIChatRequest): Promise<AIChatResult> {
    const model = request.model ?? this.defaultChatModel();
    const start = Date.now();

    const text = await this.withRetry(
      () =>
        this.bedrockChat(
          model,
          request.systemPrompt,
          request.userMessage,
          request.maxTokens ?? config.bedrock.maxTokens,
          request.temperature ?? 0.7
        ),
      "chat",
      model
    );

    return {
      text,
      provider: this.name,
      modelUsed: model.modelId,
      durationMs: Date.now() - start,
    };
  }

  async structured<T>(request: AIChatRequest): Promise<T> {
    const result = await this.chat(request);
    return parseJsonAny<T>(result.text);
  }

  async embed(request: AIEmbeddingRequest): Promise<AIEmbeddingResult> {
    const model = request.model ?? this.defaultEmbeddingModel();
    const start = Date.now();

    const vector = await this.withRetry(
      () => this.bedrockEmbed(model, request.text),
      "embedding",
      model
    );

    const dimension = model.dimensions ?? config.embedding.dimension;
    validateEmbeddingVector(vector, dimension);

    return {
      vector,
      provider: this.name,
      modelUsed: model.modelId,
      dimension,
      durationMs: Date.now() - start,
    };
  }

  async healthCheck(request?: AIHealthCheckRequest): Promise<AIHealthResult> {
    const start = Date.now();

    if (!this.hasCredentials()) {
      return {
        provider: this.name,
        healthy: false,
        latencyMs: 0,
        error: "AWS credentials missing",
      };
    }

    const model =
      request?.model ??
      (request?.task === "embedding"
        ? this.defaultEmbeddingModel()
        : this.defaultChatModel());

    try {
      if (this.isEmbeddingModel(model)) {
        const result = await this.embed({
          text: "ContextOS health check",
          model,
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
        model,
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
        details: {
          modelUsed: model.modelId,
        },
      };
    }
  }

  async sendMessage(systemPrompt: string, userMessage: string): Promise<string> {
    const result = await this.chat({ systemPrompt, userMessage });
    return result.text;
  }

  async sendExtraction(
    systemPrompt: string,
    userMessage: string
  ): Promise<string> {
    const result = await this.chat({
      systemPrompt,
      userMessage,
      model: this.defaultExtractionModel(),
      maxTokens: config.extraction.maxTokens,
      temperature: config.extraction.temperature,
    });

    return result.text;
  }

  async sendMessageStream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (chunk: string) => void
  ): Promise<string> {
    const model = this.defaultChatModel();

    return this.bedrockChatStream(
      model,
      systemPrompt,
      userMessage,
      onChunk,
      config.bedrock.maxTokens,
      0.7
    );
  }

  async generateResponse(
    prompt: string,
    options?: {
      systemPrompt?: string;
      maxTokens?: number;
    }
  ): Promise<string> {
    const result = await this.chat({
      systemPrompt: options?.systemPrompt ?? "",
      userMessage: prompt,
      maxTokens: options?.maxTokens ?? config.bedrock.maxTokens,
    });

    return result.text;
  }

  async generateStructured<T>(
    message: string,
    systemPrompt: string
  ): Promise<T> {
    return this.structured<T>({
      systemPrompt,
      userMessage: message,
      model: this.defaultExtractionModel(),
      maxTokens: config.extraction.maxTokens,
      temperature: config.extraction.temperature,
    });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const result = await this.embed({ text });
    return result.vector;
  }

  getEmbeddingDimension(): number {
    return config.embedding.dimension;
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

  private hasCredentials(): boolean {
    return Boolean(
      config.aws.accessKeyId &&
        config.aws.accessKeyId.length > 0 &&
        config.aws.secretAccessKey &&
        config.aws.secretAccessKey.length > 0
    );
  }

  private defaultChatModel(): AIModelRef {
    return this.normalizeBedrockModel(config.ai.models.chat);
  }

  private defaultExtractionModel(): AIModelRef {
    return this.normalizeBedrockModel(config.ai.models.extraction);
  }

  private defaultEmbeddingModel(): AIModelRef {
    return this.normalizeBedrockModel(config.ai.models.embedding);
  }

  private normalizeBedrockModel(uri: string): AIModelRef {
    const ref = parseModelUri(uri, "bedrock");

    if (!ref.region) {
      ref.region = config.bedrock.region;
    }

    if (!ref.dimensions && this.isEmbeddingModel(ref)) {
      ref.dimensions = config.embedding.dimension;
    }

    return ref;
  }

  private isEmbeddingModel(model: AIModelRef): boolean {
    const id = model.modelId.toLowerCase();
    return id.includes("embed") || id.includes("titan-embed");
  }

  private getClient(region: string): any {
    if (!this.sdk) {
      throw new AIError("AWS SDK not initialized", {
        code: "BEDROCK_SDK_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const existing = this.clients.get(region);

    if (existing) {
      return existing;
    }

    const client = new this.sdk.BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
      maxAttempts: 1,
    });

    this.clients.set(region, client);
    return client;
  }

  private async bedrockChat(
    model: AIModelRef,
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    if (!model.modelId) {
      throw new AIError("Bedrock chat model is not configured", {
        code: "BEDROCK_MODEL_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const region = model.region ?? config.bedrock.region;

    const body = this.buildChatBody(
      model.modelId,
      systemPrompt,
      userMessage,
      maxTokens,
      temperature
    );

    const command = new this.InvokeModelCommand({
      modelId: model.modelId,
      contentType: "application/json",
      accept: "application/json",
      body,
    });

    const response: any = await this.withTimeout(
      this.getClient(region).send(command),
      config.ai.requestTimeoutMs,
      "Bedrock chat"
    );

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (responseBody.output?.message?.content) {
      const content = responseBody.output.message.content;

      if (!Array.isArray(content) || content.length === 0) {
        throw new AIError("Empty Bedrock response", {
          code: "BEDROCK_EMPTY_RESPONSE",
          provider: this.name,
          retryable: true,
        });
      }

      return content
        .map((block: { text?: string }) => block.text ?? "")
        .join("");
    }

    if (Array.isArray(responseBody.content)) {
      if (responseBody.content.length === 0) {
        throw new AIError("Empty Bedrock response", {
          code: "BEDROCK_EMPTY_RESPONSE",
          provider: this.name,
          retryable: true,
        });
      }

      return responseBody.content
        .filter((block: { type?: string }) => block.type === "text")
        .map((block: { text?: string }) => block.text ?? "")
        .join("");
    }

    if (typeof responseBody.completion === "string") {
      return responseBody.completion;
    }

    if (typeof responseBody.message?.content === "string") {
      return responseBody.message.content;
    }

    throw new AIError("Unexpected Bedrock chat response format", {
      code: "BEDROCK_BAD_RESPONSE",
      provider: this.name,
      retryable: false,
    });
  }

  private async bedrockChatStream(
    model: AIModelRef,
    systemPrompt: string,
    userMessage: string,
    onChunk: (chunk: string) => void,
    maxTokens: number,
    temperature: number
  ): Promise<string> {
    if (!model.modelId) {
      throw new AIError("Bedrock chat model is not configured", {
        code: "BEDROCK_MODEL_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const region = model.region ?? config.bedrock.region;

    const body = this.buildChatBody(
      model.modelId,
      systemPrompt,
      userMessage,
      maxTokens,
      temperature
    );

    const command = new this.InvokeModelWithResponseStreamCommand({
      modelId: model.modelId,
      contentType: "application/json",
      accept: "application/json",
      body,
    });

    const response: any = await this.withTimeout(
      this.getClient(region).send(command),
      config.ai.requestTimeoutMs,
      "Bedrock stream"
    );

    let fullText = "";

    if (response.body) {
      for await (const event of response.body) {
        if (event.chunk?.bytes) {
          const chunkData = JSON.parse(
            new TextDecoder().decode(event.chunk.bytes)
          );

          const text =
            chunkData.contentBlockDelta?.delta?.text ??
            (chunkData.type === "content_block_delta"
              ? chunkData.delta?.text
              : undefined);

          if (text) {
            fullText += text;
            onChunk(text);
          }
        }
      }
    }

    return fullText;
  }

  private async bedrockEmbed(
    model: AIModelRef,
    text: string
  ): Promise<number[]> {
    if (!model.modelId) {
      throw new AIError("Bedrock embedding model is not configured", {
        code: "BEDROCK_EMBEDDING_MODEL_MISSING",
        provider: this.name,
        retryable: false,
      });
    }

    const region = model.region ?? config.bedrock.region;
    const cleaned = text.trim().substring(0, config.embedding.textMaxLength);

    let body: string;

    if (model.modelId.toLowerCase().includes("cohere")) {
      body = JSON.stringify({
        texts: [cleaned],
        input_type: "search_document",
      });
    } else {
      body = JSON.stringify({
        inputText: cleaned,
      });
    }

    const command = new this.InvokeModelCommand({
      modelId: model.modelId,
      contentType: "application/json",
      accept: "application/json",
      body,
    });

    const response: any = await this.withTimeout(
      this.getClient(region).send(command),
      config.ai.requestTimeoutMs,
      "Bedrock embedding"
    );

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    if (Array.isArray(responseBody.embedding)) {
      return responseBody.embedding.map(Number);
    }

    if (Array.isArray(responseBody.embeddings)) {
      return responseBody.embeddings[0].map(Number);
    }

    throw new AIError("Unexpected Bedrock embedding response format", {
      code: "BEDROCK_BAD_EMBEDDING_RESPONSE",
      provider: this.name,
      retryable: false,
    });
  }

  private buildChatBody(
    modelId: string,
    systemPrompt: string,
    userMessage: string,
    maxTokens: number,
    temperature: number
  ): string {
    if (modelId.includes("nova")) {
      return JSON.stringify({
        messages: [{ role: "user", content: [{ text: userMessage }] }],
        system: [{ text: systemPrompt }],
        inferenceConfig: { maxTokens, temperature },
      });
    }

    return JSON.stringify({
      anthropic_version: "bedrock-2023-05-31",
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    label: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new AIError(`${label} timed out after ${timeoutMs}ms`, {
                  code: "BEDROCK_TIMEOUT",
                  provider: this.name,
                  retryable: true,
                })
              ),
            timeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async withRetry<T>(
    fn: () => Promise<T>,
    task: string,
    model: AIModelRef
  ): Promise<T> {
    let lastError: Error | null = null;
    const maxRetries = config.ai.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (!this.isRetryableError(lastError) || attempt >= maxRetries) {
          break;
        }

        await sleep(config.ai.retryDelayMs * Math.pow(2, attempt));
      }
    }

    throw new AIError(lastError?.message ?? "Bedrock request failed", {
      code: "BEDROCK_REQUEST_FAILED",
      provider: this.name,
      task,
      retryable: this.isRetryableError(lastError),
    });
  }

  private isRetryableError(error: Error | null): boolean {
    if (!error) return false;

    const msg = error.message.toLowerCase();

    return (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("throttl") ||
      msg.includes("rate") ||
      msg.includes("429") ||
      msg.includes("500") ||
      msg.includes("503") ||
      msg.includes("connection") ||
      msg.includes("network") ||
      msg.includes("socket")
    );
  }
}

let bedrockClientInstance: BedrockClient | null = null;

export function getBedrockClient(): BedrockClient {
  if (!bedrockClientInstance) {
    bedrockClientInstance = new BedrockClient();
  }

  return bedrockClientInstance;
}