export type AITask = "chat" | "extraction" | "structured" | "embedding";

export interface AIModelRef {
  provider: string;
  modelId: string;
  region?: string;
  endpoint?: string;
  dimensions?: number;
  label?: string;
}

export interface AIChatRequest {
  systemPrompt: string;
  userMessage: string;
  model?: AIModelRef;
  maxTokens?: number;
  temperature?: number;
}

export interface AIChatResult {
  text: string;
  provider: string;
  modelUsed: string;
  durationMs: number;
}

export interface AIEmbeddingRequest {
  text: string;
  model?: AIModelRef;
}

export interface AIEmbeddingResult {
  vector: number[];
  provider: string;
  modelUsed: string;
  dimension: number;
  durationMs: number;
}

export interface AIHealthCheckRequest {
  model?: AIModelRef;
  task?: AITask;
}

export interface AIHealthResult {
  provider: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface AIProvider {
  name: string;
  supportsTask(task: AITask): boolean;
  chat(request: AIChatRequest): Promise<AIChatResult>;
  structured<T>(request: AIChatRequest): Promise<T>;
  embed(request: AIEmbeddingRequest): Promise<AIEmbeddingResult>;
  healthCheck(request?: AIHealthCheckRequest): Promise<AIHealthResult>;
}

export class AIError extends Error {
  code: string;
  provider?: string;
  task?: string;
  retryable: boolean;

  constructor(
    message: string,
    options?: {
      code?: string;
      provider?: string;
      task?: string;
      retryable?: boolean;
    }
  ) {
    super(message);
    this.name = "AIError";
    this.code = options?.code ?? "AI_ERROR";
    this.provider = options?.provider;
    this.task = options?.task;
    this.retryable = options?.retryable ?? false;
  }
}

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalizeProviderName(value: string | undefined | null): string {
  const raw = String(value ?? "")
    .toLowerCase()
    .trim();

  if (!raw) return "";

  if (raw === "gemini" || raw === "googleai" || raw === "google-ai") {
    return "google";
  }

  if (raw === "nim" || raw === "nvidia-nim" || raw === "nvidianim") {
    return "nvidia";
  }

  if (raw === "samba" || raw === "samba-nova") {
    return "sambanova";
  }

  return raw;
}

export function parseProviderList(value: string | undefined | null): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of String(value ?? "").split(",")) {
    const normalized = normalizeProviderName(item);
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function parseModelUri(
  input: string | undefined | null,
  defaultProvider: string = "bedrock"
): AIModelRef {
  const value = (input || "").trim();

  if (!value) {
    return { provider: defaultProvider, modelId: "" };
  }

  if (value.startsWith("arn:") || value.includes("inference-profile")) {
    return { provider: "bedrock", modelId: value };
  }

  const schemeIndex = value.indexOf("://");

  if (schemeIndex === -1) {
    return { provider: defaultProvider, modelId: value };
  }

  const provider = normalizeProviderName(value.slice(0, schemeIndex)) || defaultProvider;
  const rest = value.slice(schemeIndex + 3);

  let modelId = rest;
  let queryString = "";

  const queryIndex = rest.indexOf("?");

  if (queryIndex !== -1) {
    modelId = rest.slice(0, queryIndex);
    queryString = rest.slice(queryIndex + 1);
  }

  const params = new URLSearchParams(queryString);

  const ref: AIModelRef = { provider, modelId };

  const region = params.get("region");
  const endpoint = params.get("endpoint");
  const dimensions = params.get("dimensions");
  const label = params.get("label");

  if (region) ref.region = region;
  if (endpoint) ref.endpoint = endpoint;

  if (dimensions) {
    const parsed = Number(dimensions);
    if (Number.isFinite(parsed)) ref.dimensions = parsed;
  }

  if (label) ref.label = label;

  return ref;
}

export function validateEmbeddingVector(
  vector: number[],
  expectedDimension: number
): void {
  if (!Array.isArray(vector)) {
    throw new AIError("Embedding is not an array", {
      code: "EMBEDDING_INVALID",
      retryable: false,
    });
  }

  if (vector.length !== expectedDimension) {
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

export function isRetryableAiError(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof AIError) {
    return error.retryable;
  }

  const message = String((error as Error).message ?? "").toLowerCase();

  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("throttl") ||
    message.includes("rate") ||
    message.includes("429") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("connection") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("abort") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}

export function parseJsonAny<T = unknown>(input: string): T {
  const trimmed = (input || "").trim();

  if (!trimmed) {
    throw new AIError("Empty AI response", {
      code: "AI_EMPTY_RESPONSE",
      retryable: true,
    });
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);

  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim()) as T;
    } catch {}
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);

  if (arrayMatch) {
    try {
      return JSON.parse(arrayMatch[0]) as T;
    } catch {}
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);

  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]) as T;
    } catch {}
  }

  throw new AIError("Failed to parse AI response as JSON", {
    code: "AI_INVALID_JSON",
    retryable: false,
  });
}

export function parseJsonArray<T = unknown>(input: string): T[] {
  const parsed = parseJsonAny<T[] | T>(input);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (parsed && typeof parsed === "object") {
    return [parsed as T];
  }

  return [];
}