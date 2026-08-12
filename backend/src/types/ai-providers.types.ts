import type { AIProvider, AITask } from "../agent/ai-provider";

export type CloudProviderName =
  | "google"
  | "groq"
  | "sambanova"
  | "mistral"
  | "nvidia"
  | "openai-compatible";

export interface ProviderDefinition {
  name: string;
  label: string;
  apiKey: string;
  baseUrl: string;
  chatModel: string;
  extractionModel: string;
  embeddingModel: string;
  embeddingDimensions: number;
  supportsEmbeddings: boolean;
  supportsJsonMode: boolean;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
  extraHeaders?: Record<string, string>;
}

export interface ProviderRegistryOptions {
  existingProviders?: Record<string, AIProvider>;
  defaultProvider?: string;
  fallbackProviders?: string[];
}

export interface ProviderOrderInfo {
  defaultProvider: string | null;
  fallbackProviders: string[];
  order: string[];
}

export interface ProviderHealthEntry {
  name: string;
  healthy: boolean;
  latencyMs: number;
  error?: string;
  modelUsed?: string;
}

export interface ProviderHealthReport {
  status: "healthy" | "degraded" | "unhealthy";
  checked: number;
  healthy: number;
  latencyMs: number;
  entries: ProviderHealthEntry[];
  errors: string[];
}

export type ProviderTask = AITask;