import { parseModelUri } from "./ai-provider";
import type { ProviderDefinition } from "../types/ai-providers.types";

function envString(name: string, fallback: string = ""): string {
  const value = process.env[name];
  return typeof value === "string" ? value.trim() : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const num = Number(raw);
  return Number.isFinite(num) && num > 0 ? num : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim().length === 0) return fallback;
  const value = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(value)) return true;
  if (["false", "0", "no", "off"].includes(value)) return false;
  return fallback;
}

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function providerMatches(rawProvider: string, name: string): boolean {
  const value = rawProvider.toLowerCase().trim();

  if (!value) return false;
  if (value === name) return true;

  if (name === "google") {
    return ["gemini", "googleai", "google-ai"].includes(value);
  }

  if (name === "nvidia") {
    return ["nim", "nvidia-nim", "nvidianim"].includes(value);
  }

  if (name === "sambanova") {
    return ["samba", "samba-nova"].includes(value);
  }

  return false;
}

function modelIdFromUri(envName: string, providerName: string): string {
  const raw = envString(envName);
  if (!raw) return "";

  const ref = parseModelUri(raw, "");
  if (!ref.modelId) return "";

  return providerMatches(ref.provider, providerName) ? ref.modelId : "";
}

function providerEnabled(prefix: string, hasKey: boolean): boolean {
  if (!hasKey) return false;
  return envBool(`${prefix}_ENABLED`, true);
}

function commonTimeoutMs(): number {
  return envNumber("AI_REQUEST_TIMEOUT_MS", 60000);
}

function commonMaxRetries(): number {
  return envNumber("AI_MAX_RETRIES", 2);
}

function commonRetryDelayMs(): number {
  return envNumber("AI_RETRY_DELAY_MS", 500);
}

function embeddingDimensions(prefix: string): number {
  return envNumber(
    `${prefix}_EMBEDDING_DIMENSION`,
    envNumber("EMBEDDING_DIMENSION", 1024)
  );
}

function buildGoogleDefinition(): ProviderDefinition | null {
  const apiKey = firstNonEmpty(
    envString("GOOGLE_API_KEY"),
    envString("GOOGLE_AI_API_KEY"),
    envString("GEMINI_API_KEY")
  );

  if (!providerEnabled("GOOGLE", Boolean(apiKey))) return null;

  const chatModel = firstNonEmpty(
    envString("GOOGLE_CHAT_MODEL"),
    modelIdFromUri("AI_CHAT_MODEL", "google"),
    "gemini-2.5-flash"
  );

  const extractionModel = firstNonEmpty(
    envString("GOOGLE_EXTRACTION_MODEL"),
    modelIdFromUri("AI_EXTRACTION_MODEL", "google"),
    chatModel
  );

  const embeddingModel = firstNonEmpty(
    envString("GOOGLE_EMBEDDING_MODEL"),
    modelIdFromUri("AI_EMBEDDING_MODEL", "google")
  );

  return {
    name: "google",
    label: "Google Gemini",
    apiKey,
    baseUrl: firstNonEmpty(
      envString("GOOGLE_BASE_URL"),
      "https://generativelanguage.googleapis.com"
    ),
    chatModel,
    extractionModel,
    embeddingModel,
    embeddingDimensions: embeddingDimensions("GOOGLE"),
    supportsEmbeddings: Boolean(embeddingModel),
    supportsJsonMode: envBool("GOOGLE_JSON_MODE", true),
    timeoutMs: envNumber("GOOGLE_TIMEOUT_MS", commonTimeoutMs()),
    maxRetries: envNumber("GOOGLE_MAX_RETRIES", commonMaxRetries()),
    retryDelayMs: envNumber("GOOGLE_RETRY_DELAY_MS", commonRetryDelayMs()),
  };
}

function buildGroqDefinition(): ProviderDefinition | null {
  const apiKey = firstNonEmpty(envString("GROQ_API_KEY"));

  if (!providerEnabled("GROQ", Boolean(apiKey))) return null;

  const chatModel = firstNonEmpty(
    envString("GROQ_CHAT_MODEL"),
    modelIdFromUri("AI_CHAT_MODEL", "groq"),
    "llama-3.3-70b-versatile"
  );

  const extractionModel = firstNonEmpty(
    envString("GROQ_EXTRACTION_MODEL"),
    modelIdFromUri("AI_EXTRACTION_MODEL", "groq"),
    firstNonEmpty(envString("GROQ_CHAT_MODEL"), chatModel)
  );

  const embeddingModel = firstNonEmpty(
    envString("GROQ_EMBEDDING_MODEL"),
    modelIdFromUri("AI_EMBEDDING_MODEL", "groq")
  );

  return {
    name: "groq",
    label: "Groq",
    apiKey,
    baseUrl: firstNonEmpty(
      envString("GROQ_BASE_URL"),
      "https://api.groq.com/openai/v1"
    ),
    chatModel,
    extractionModel,
    embeddingModel,
    embeddingDimensions: embeddingDimensions("GROQ"),
    supportsEmbeddings: Boolean(embeddingModel),
    supportsJsonMode: envBool("GROQ_JSON_MODE", false),
    timeoutMs: envNumber("GROQ_TIMEOUT_MS", commonTimeoutMs()),
    maxRetries: envNumber("GROQ_MAX_RETRIES", commonMaxRetries()),
    retryDelayMs: envNumber("GROQ_RETRY_DELAY_MS", commonRetryDelayMs()),
  };
}

function buildSambaNovaDefinition(): ProviderDefinition | null {
  const apiKey = firstNonEmpty(
    envString("SAMBANOVA_API_KEY"),
    envString("SAMBA_API_KEY")
  );

  if (!providerEnabled("SAMBANOVA", Boolean(apiKey))) return null;

  const chatModel = firstNonEmpty(
    envString("SAMBANOVA_CHAT_MODEL"),
    modelIdFromUri("AI_CHAT_MODEL", "sambanova"),
    "Meta-Llama-3.3-70B-Instruct"
  );

  const extractionModel = firstNonEmpty(
    envString("SAMBANOVA_EXTRACTION_MODEL"),
    modelIdFromUri("AI_EXTRACTION_MODEL", "sambanova"),
    chatModel
  );

  const embeddingModel = firstNonEmpty(
    envString("SAMBANOVA_EMBEDDING_MODEL"),
    modelIdFromUri("AI_EMBEDDING_MODEL", "sambanova")
  );

  return {
    name: "sambanova",
    label: "SambaNova",
    apiKey,
    baseUrl: firstNonEmpty(
      envString("SAMBANOVA_BASE_URL"),
      "https://api.sambanova.ai/v1"
    ),
    chatModel,
    extractionModel,
    embeddingModel,
    embeddingDimensions: embeddingDimensions("SAMBANOVA"),
    supportsEmbeddings: Boolean(embeddingModel),
    supportsJsonMode: envBool("SAMBANOVA_JSON_MODE", false),
    timeoutMs: envNumber("SAMBANOVA_TIMEOUT_MS", commonTimeoutMs()),
    maxRetries: envNumber("SAMBANOVA_MAX_RETRIES", commonMaxRetries()),
    retryDelayMs: envNumber("SAMBANOVA_RETRY_DELAY_MS", commonRetryDelayMs()),
  };
}

function buildMistralDefinition(): ProviderDefinition | null {
  const apiKey = firstNonEmpty(envString("MISTRAL_API_KEY"));

  if (!providerEnabled("MISTRAL", Boolean(apiKey))) return null;

  const chatModel = firstNonEmpty(
    envString("MISTRAL_CHAT_MODEL"),
    modelIdFromUri("AI_CHAT_MODEL", "mistral"),
    "mistral-small-latest"
  );

  const extractionModel = firstNonEmpty(
    envString("MISTRAL_EXTRACTION_MODEL"),
    modelIdFromUri("AI_EXTRACTION_MODEL", "mistral"),
    chatModel
  );

  const embeddingModel = firstNonEmpty(
    envString("MISTRAL_EMBEDDING_MODEL"),
    modelIdFromUri("AI_EMBEDDING_MODEL", "mistral"),
    "mistral-embed"
  );

  return {
    name: "mistral",
    label: "Mistral AI",
    apiKey,
    baseUrl: firstNonEmpty(
      envString("MISTRAL_BASE_URL"),
      "https://api.mistral.ai/v1"
    ),
    chatModel,
    extractionModel,
    embeddingModel,
    embeddingDimensions: embeddingDimensions("MISTRAL"),
    supportsEmbeddings: Boolean(embeddingModel),
    supportsJsonMode: envBool("MISTRAL_JSON_MODE", false),
    timeoutMs: envNumber("MISTRAL_TIMEOUT_MS", commonTimeoutMs()),
    maxRetries: envNumber("MISTRAL_MAX_RETRIES", commonMaxRetries()),
    retryDelayMs: envNumber("MISTRAL_RETRY_DELAY_MS", commonRetryDelayMs()),
  };
}

function buildNvidiaDefinition(): ProviderDefinition | null {
  const apiKey = firstNonEmpty(
    envString("NVIDIA_NIM_API_KEY"),
    envString("NVIDIA_API_KEY")
  );

  if (!providerEnabled("NVIDIA", Boolean(apiKey))) return null;

  const chatModel = firstNonEmpty(
    envString("NVIDIA_CHAT_MODEL"),
    modelIdFromUri("AI_CHAT_MODEL", "nvidia"),
    "meta/llama-3.3-70b-instruct"
  );

  const extractionModel = firstNonEmpty(
    envString("NVIDIA_EXTRACTION_MODEL"),
    modelIdFromUri("AI_EXTRACTION_MODEL", "nvidia"),
    chatModel
  );

  const embeddingModel = firstNonEmpty(
    envString("NVIDIA_EMBEDDING_MODEL"),
    modelIdFromUri("AI_EMBEDDING_MODEL", "nvidia")
  );

  return {
    name: "nvidia",
    label: "NVIDIA NIM",
    apiKey,
    baseUrl: firstNonEmpty(
      envString("NVIDIA_BASE_URL"),
      "https://integrate.api.nvidia.com/v1"
    ),
    chatModel,
    extractionModel,
    embeddingModel,
    embeddingDimensions: embeddingDimensions("NVIDIA"),
    supportsEmbeddings: Boolean(embeddingModel),
    supportsJsonMode: envBool("NVIDIA_JSON_MODE", false),
    timeoutMs: envNumber("NVIDIA_TIMEOUT_MS", commonTimeoutMs()),
    maxRetries: envNumber("NVIDIA_MAX_RETRIES", commonMaxRetries()),
    retryDelayMs: envNumber("NVIDIA_RETRY_DELAY_MS", commonRetryDelayMs()),
  };
}

export function getCloudProviderDefinitions(): ProviderDefinition[] {
  const definitions: ProviderDefinition[] = [];

  const google = buildGoogleDefinition();
  if (google) definitions.push(google);

  const groq = buildGroqDefinition();
  if (groq) definitions.push(groq);

  const sambanova = buildSambaNovaDefinition();
  if (sambanova) definitions.push(sambanova);

  const mistral = buildMistralDefinition();
  if (mistral) definitions.push(mistral);

  const nvidia = buildNvidiaDefinition();
  if (nvidia) definitions.push(nvidia);

  return definitions;
}

export function getEnabledCloudProviderNames(): string[] {
  return getCloudProviderDefinitions().map((definition) => definition.name);
}