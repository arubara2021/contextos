import "dotenv/config";
import { z } from "zod";

function normalizeProviderName(value: string): string {
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

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "staging", "test"])
    .default("development"),
  PORT: z.coerce.number().default(3001),

  COCKROACH_CONNECTION_STRING: z
    .string()
    .default("postgresql://root@localhost:26257/contextos?sslmode=disable"),

  JWT_SECRET: z
    .string()
    .min(32)
    .default("dev-jwt-secret-key-at-least-32-chars-long-for-local"),
  JWT_EXPIRES_IN: z.string().default("24h"),
  JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),

  DEV_BYPASS_AUTH: z
    .string()
    .default("false")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  DEV_BYPASS_TOKEN: z.string().default("dev-bypass-token"),
  DEV_BYPASS_EMAIL: z.string().default("demo@contextos.local"),

  AWS_REGION: z.string().default("us-east-1"),
  AWS_ACCESS_KEY_ID: z.string().default(""),
  AWS_SECRET_ACCESS_KEY: z.string().default(""),

  S3_BUCKET_NAME: z.string().default("contextos-dev"),

  BEDROCK_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase().trim() !== "false"),
  BEDROCK_REGION: z.string().default("us-east-1"),
  BEDROCK_MODEL_ID: z.string().default("anthropic.claude-3-5-sonnet-20241022-v2:0"),
  BEDROCK_EMBEDDING_MODEL_ID: z
    .string()
    .default("amazon.titan-embed-text-v2:0"),
  BEDROCK_EXTRACTION_MODEL_ID: z.string().default(""),
  BEDROCK_REQUEST_TIMEOUT_MS: z.coerce.number().default(90000),
  BEDROCK_MAX_TOKENS: z.coerce.number().default(4096),
  BEDROCK_EXTRACTION_MAX_TOKENS: z.coerce.number().default(4096),
  BEDROCK_EXTRACTION_TEMPERATURE: z.coerce.number().default(0.2),

  AI_DEFAULT_PROVIDER: z.string().default(""),
  AI_FALLBACK_PROVIDERS: z
    .string()
    .default("sambanova,mistral,groq,nvidia,bedrock")
    .transform((v) =>
      v
        .split(",")
        .map((s) => normalizeProviderName(s))
        .filter(Boolean)
    ),
  AI_STRICT_MODE: z
    .string()
    .default("false")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  AI_CHAT_MODEL: z.string().default(""),
  AI_EXTRACTION_MODEL: z.string().default(""),
  AI_EMBEDDING_MODEL: z.string().default(""),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().default(90000),
  AI_MAX_RETRIES: z.coerce.number().default(1),
  AI_RETRY_DELAY_MS: z.coerce.number().default(700),
  AI_PROVIDER_COOLDOWN_MS: z.coerce.number().default(45000),
  AI_MIN_CONCEPTS_TINY: z.coerce.number().default(1),
  AI_MIN_CONCEPTS_SMALL: z.coerce.number().default(3),
  AI_MIN_CONCEPTS_LARGE: z.coerce.number().default(10),
  AI_LARGE_DOCUMENT_WORDS: z.coerce.number().default(3000),

  OPENAI_API_KEY: z.string().default(""),
  OPENAI_BASE_URL: z.string().default("https://api.openai.com/v1"),

  GOOGLE_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase().trim() !== "false"),
  GOOGLE_API_KEY: z.string().default(""),
  GOOGLE_BASE_URL: z
    .string()
    .default("https://generativelanguage.googleapis.com"),
  GOOGLE_CHAT_MODEL: z.string().default("gemini-2.5-flash"),
  GOOGLE_EXTRACTION_MODEL: z.string().default(""),
  GOOGLE_EMBEDDING_MODEL: z.string().default(""),
  GOOGLE_EMBEDDING_DIMENSION: z.coerce.number().default(1024),
  GOOGLE_JSON_MODE: z
    .string()
    .default("true")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  GOOGLE_TIMEOUT_MS: z.coerce.number().default(90000),
  GOOGLE_MAX_RETRIES: z.coerce.number().default(1),
  GOOGLE_RETRY_DELAY_MS: z.coerce.number().default(700),

  GROQ_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase().trim() !== "false"),
  GROQ_API_KEY: z.string().default(""),
  GROQ_BASE_URL: z.string().default("https://api.groq.com/openai/v1"),
  GROQ_CHAT_MODEL: z.string().default("llama-3.3-70b-versatile"),
  GROQ_EXTRACTION_MODEL: z.string().default(""),
  GROQ_EMBEDDING_MODEL: z.string().default(""),
  GROQ_EMBEDDING_DIMENSION: z.coerce.number().default(1024),
  GROQ_JSON_MODE: z
    .string()
    .default("false")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  GROQ_TIMEOUT_MS: z.coerce.number().default(90000),
  GROQ_MAX_RETRIES: z.coerce.number().default(1),
  GROQ_RETRY_DELAY_MS: z.coerce.number().default(700),

  SAMBANOVA_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase().trim() !== "false"),
  SAMBANOVA_API_KEY: z.string().default(""),
  SAMBANOVA_BASE_URL: z.string().default("https://api.sambanova.ai/v1"),
  SAMBANOVA_CHAT_MODEL: z.string().default("Meta-Llama-3.3-70B-Instruct"),
  SAMBANOVA_EXTRACTION_MODEL: z.string().default(""),
  SAMBANOVA_EMBEDDING_MODEL: z.string().default(""),
  SAMBANOVA_EMBEDDING_DIMENSION: z.coerce.number().default(1024),
  SAMBANOVA_JSON_MODE: z
    .string()
    .default("false")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  SAMBANOVA_TIMEOUT_MS: z.coerce.number().default(90000),
  SAMBANOVA_MAX_RETRIES: z.coerce.number().default(1),
  SAMBANOVA_RETRY_DELAY_MS: z.coerce.number().default(700),

  MISTRAL_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase().trim() !== "false"),
  MISTRAL_API_KEY: z.string().default(""),
  MISTRAL_BASE_URL: z.string().default("https://api.mistral.ai/v1"),
  MISTRAL_CHAT_MODEL: z.string().default("mistral-small-latest"),
  MISTRAL_EXTRACTION_MODEL: z.string().default(""),
  MISTRAL_EMBEDDING_MODEL: z.string().default("mistral-embed"),
  MISTRAL_EMBEDDING_DIMENSION: z.coerce.number().default(1024),
  MISTRAL_JSON_MODE: z
    .string()
    .default("false")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  MISTRAL_TIMEOUT_MS: z.coerce.number().default(90000),
  MISTRAL_MAX_RETRIES: z.coerce.number().default(1),
  MISTRAL_RETRY_DELAY_MS: z.coerce.number().default(700),

  NVIDIA_ENABLED: z
    .string()
    .default("true")
    .transform((v) => v.toLowerCase().trim() !== "false"),
  NVIDIA_NIM_API_KEY: z.string().default(""),
  NVIDIA_API_KEY: z.string().default(""),
  NVIDIA_BASE_URL: z.string().default("https://integrate.api.nvidia.com/v1"),
  NVIDIA_CHAT_MODEL: z.string().default("meta/llama-3.3-70b-instruct"),
  NVIDIA_EXTRACTION_MODEL: z.string().default(""),
  NVIDIA_EMBEDDING_MODEL: z.string().default(""),
  NVIDIA_EMBEDDING_DIMENSION: z.coerce.number().default(1024),
  NVIDIA_JSON_MODE: z
    .string()
    .default("false")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  NVIDIA_TIMEOUT_MS: z.coerce.number().default(90000),
  NVIDIA_MAX_RETRIES: z.coerce.number().default(1),
  NVIDIA_RETRY_DELAY_MS: z.coerce.number().default(700),

  OLLAMA_ENABLED: z
    .string()
    .default("false")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  OLLAMA_BASE_URL: z.string().default("http://localhost:11434"),
  OLLAMA_CHAT_MODEL: z.string().default("llama3.2:3b"),
  OLLAMA_EMBEDDING_MODEL: z.string().default("mxbai-embed-large"),

  EMBEDDING_DIMENSION: z.coerce.number().default(1024),
  EMBEDDING_CONCURRENCY: z.coerce.number().default(4),
  EMBEDDING_TEXT_MAX_LENGTH: z.coerce.number().default(8000),

  MAX_CONTEXT_MEMORIES: z.coerce.number().default(20),
  MIN_CHUNK_TOKENS: z.coerce.number().default(150),
  MAX_CHUNK_TOKENS: z.coerce.number().default(250),
  MAX_DOCUMENT_TOKENS_SINGLE_CALL: z.coerce.number().default(200000),
  MAX_CONCEPTS_PER_DOCUMENT: z.coerce.number().default(80),
  MIN_CONCEPT_IMPORTANCE: z.coerce.number().default(4),

  EXTRACTION_RETRY_COUNT: z.coerce.number().default(2),
  EXTRACTION_RETRY_DELAY_MS: z.coerce.number().default(1500),
  EXTRACTION_EXISTING_MEMORY_LIMIT: z.coerce.number().default(40),
  EXTRACTION_MAX_RELATED_PER_CONCEPT: z.coerce.number().default(4),
  EXTRACTION_SECTION_CONCURRENCY: z.coerce.number().default(2),
  EXTRACTION_SECTION_CHAR_CAP: z.coerce.number().default(8000),
  EXTRACTION_SINGLE_CALL_CHAR_THRESHOLD: z.coerce.number().default(6000),
  EXTRACTION_MIN_SECTION_CHARS: z.coerce.number().default(500),
  EXTRACTION_MAX_SECTIONS: z.coerce.number().default(20),
  EXTRACTION_MAX_OUTPUT_TOKENS: z.coerce.number().default(4096),

  DEFAULT_DECAY_RATE: z.coerce.number().default(0.15),
  HIGH_IMPORTANCE_DECAY_RATE: z.coerce.number().default(0.1),
  LOW_IMPORTANCE_DECAY_RATE: z.coerce.number().default(0.2),
  STRONG_THRESHOLD: z.coerce.number().default(0.7),
  FADING_THRESHOLD: z.coerce.number().default(0.4),
  CRITICAL_THRESHOLD: z.coerce.number().default(0.4),
  FORGOTTEN_THRESHOLD: z.coerce.number().default(0.1),
  RETAIN_WEIGHT: z.coerce.number().default(0.7),
  ACCESS_BOOST_WEIGHT: z.coerce.number().default(0.3),

  BCRYPT_ROUNDS: z.coerce.number().default(12),

  CORS_ORIGIN: z.string().default("*"),
  CORS_FRONTEND_URL: z.string().default("http://localhost:3000"),
  LOG_LEVEL: z.enum(["error", "warn", "info", "debug"]).default("info"),

  DB_POOL_MAX: z.coerce.number().default(20),
  DB_MAX_CONNECTIONS: z.coerce.number().default(20),
  DB_POOL_IDLE_TIMEOUT_MS: z.coerce.number().default(30000),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().default(20000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().default(30000),

  SCORER_SEMANTIC_WEIGHT: z.coerce.number().default(0.45),
  SCORER_STRENGTH_WEIGHT: z.coerce.number().default(0.3),
  SCORER_RECENCY_WEIGHT: z.coerce.number().default(0.25),
  SCORER_RECENCY_DECAY_FACTOR: z.coerce.number().default(0.1),
  SCORER_TIE_BREAK_THRESHOLD: z.coerce.number().default(0.05),

  REMINDER_CHECK_INTERVAL_HOURS: z.coerce.number().default(24),
  REMINDER_MIN_IMPORTANCE: z.coerce.number().default(7),
  REMINDER_MAX_TOPICS_SHOWN: z.coerce.number().default(5),

  RELATIONSHIP_CROSS_CHUNK_CONFIDENCE: z.coerce.number().default(0.7),
  RELATIONSHIP_SIMILARITY_MIN: z.coerce.number().default(0.6),
  RELATIONSHIP_SIMILARITY_MAX: z.coerce.number().default(0.99),

  CONVERSATION_IDLE_TIMEOUT_MS: z.coerce.number().default(900000),

  CORRELATION_ENABLED: z
    .string()
    .default("true")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  CORRELATION_MIN_SIMILARITY: z.coerce.number().default(0.7),
  CORRELATION_STRONG_SIMILARITY: z.coerce.number().default(0.8),
  CORRELATION_MAX_LINKS_PER_CONCEPT: z.coerce.number().default(5),
  CORRELATION_MAX_EDGES_PER_DOCUMENT: z.coerce.number().default(150),
  CORRELATION_DOCUMENT_TOP_N: z.coerce.number().default(10),
  CONNECTIVITY_SCORE_WEIGHT: z.coerce.number().default(0.12),

  AI_RELATIONSHIP_TYPING_ENABLED: z
    .string()
    .default("false")
    .transform((v) => ["true", "1", "yes"].includes(v.toLowerCase().trim())),
  AI_RELATIONSHIP_TYPING_MAX_CALLS: z.coerce.number().default(20),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment variables:",
    parsed.error.flatten().fieldErrors
  );
  process.exit(1);
}

const env = parsed.data;

function firstNonEmpty(...values: Array<string | undefined | null>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }

  return "";
}

function buildModelUri(
  provider: string,
  modelId: string,
  region?: string
): string {
  if (!modelId) return "";

  if (provider === "bedrock") {
    return `bedrock://${modelId}?region=${region || env.BEDROCK_REGION}`;
  }

  return `${provider}://${modelId}`;
}

const googleApiKey = firstNonEmpty(env.GOOGLE_API_KEY);
const groqApiKey = firstNonEmpty(env.GROQ_API_KEY);
const sambanovaApiKey = firstNonEmpty(env.SAMBANOVA_API_KEY);
const mistralApiKey = firstNonEmpty(env.MISTRAL_API_KEY);
const nvidiaApiKey = firstNonEmpty(env.NVIDIA_NIM_API_KEY, env.NVIDIA_API_KEY);
const bedrockHasKeys = Boolean(
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
);

const googleChatModel = firstNonEmpty(env.GOOGLE_CHAT_MODEL, "gemini-2.5-flash");
const googleExtractionModel = firstNonEmpty(
  env.GOOGLE_EXTRACTION_MODEL,
  googleChatModel
);
const googleEmbeddingModel = firstNonEmpty(env.GOOGLE_EMBEDDING_MODEL);

const groqChatModel = firstNonEmpty(
  env.GROQ_CHAT_MODEL,
  "llama-3.3-70b-versatile"
);
const groqExtractionModel = firstNonEmpty(env.GROQ_EXTRACTION_MODEL, groqChatModel);
const groqEmbeddingModel = firstNonEmpty(env.GROQ_EMBEDDING_MODEL);

const sambanovaChatModel = firstNonEmpty(
  env.SAMBANOVA_CHAT_MODEL,
  "Meta-Llama-3.3-70B-Instruct"
);
const sambanovaExtractionModel = firstNonEmpty(
  env.SAMBANOVA_EXTRACTION_MODEL,
  sambanovaChatModel
);
const sambanovaEmbeddingModel = firstNonEmpty(env.SAMBANOVA_EMBEDDING_MODEL);

const mistralChatModel = firstNonEmpty(
  env.MISTRAL_CHAT_MODEL,
  "mistral-small-latest"
);
const mistralExtractionModel = firstNonEmpty(
  env.MISTRAL_EXTRACTION_MODEL,
  mistralChatModel
);
const mistralEmbeddingModel = firstNonEmpty(
  env.MISTRAL_EMBEDDING_MODEL,
  "mistral-embed"
);

const nvidiaChatModel = firstNonEmpty(
  env.NVIDIA_CHAT_MODEL,
  "meta/llama-3.3-70b-instruct"
);
const nvidiaExtractionModel = firstNonEmpty(
  env.NVIDIA_EXTRACTION_MODEL,
  nvidiaChatModel
);
const nvidiaEmbeddingModel = firstNonEmpty(env.NVIDIA_EMBEDDING_MODEL);

const bedrockChatModelId = firstNonEmpty(
  env.BEDROCK_MODEL_ID,
  "anthropic.claude-3-5-sonnet-20241022-v2:0"
);
const bedrockExtractionModelId = firstNonEmpty(
  env.BEDROCK_EXTRACTION_MODEL_ID,
  bedrockChatModelId
);
const bedrockEmbeddingModelId = firstNonEmpty(
  env.BEDROCK_EMBEDDING_MODEL_ID,
  "amazon.titan-embed-text-v2:0"
);

const providerDefinitions = {
  bedrock: {
    name: "bedrock",
    enabled: env.BEDROCK_ENABLED && bedrockHasKeys,
    region: env.BEDROCK_REGION,
    modelId: bedrockChatModelId,
    extractionModelId: bedrockExtractionModelId,
    embeddingModelId: bedrockEmbeddingModelId,
    embeddingDimensions: env.EMBEDDING_DIMENSION,
    timeoutMs: env.BEDROCK_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    retryDelayMs: env.AI_RETRY_DELAY_MS,
    supportsJsonMode: false,
    supportsEmbeddings: Boolean(bedrockEmbeddingModelId),
  },
  google: {
    name: "google",
    enabled: env.GOOGLE_ENABLED && googleApiKey.length > 0,
    apiKey: googleApiKey,
    baseUrl: env.GOOGLE_BASE_URL,
    chatModel: googleChatModel,
    extractionModel: googleExtractionModel,
    embeddingModel: googleEmbeddingModel,
    embeddingDimensions: env.GOOGLE_EMBEDDING_DIMENSION,
    timeoutMs: env.GOOGLE_TIMEOUT_MS,
    maxRetries: env.GOOGLE_MAX_RETRIES,
    retryDelayMs: env.GOOGLE_RETRY_DELAY_MS,
    supportsJsonMode: env.GOOGLE_JSON_MODE,
    supportsEmbeddings: googleEmbeddingModel.length > 0,
  },
  groq: {
    name: "groq",
    enabled: env.GROQ_ENABLED && groqApiKey.length > 0,
    apiKey: groqApiKey,
    baseUrl: env.GROQ_BASE_URL,
    chatModel: groqChatModel,
    extractionModel: groqExtractionModel,
    embeddingModel: groqEmbeddingModel,
    embeddingDimensions: env.GROQ_EMBEDDING_DIMENSION,
    timeoutMs: env.GROQ_TIMEOUT_MS,
    maxRetries: env.GROQ_MAX_RETRIES,
    retryDelayMs: env.GROQ_RETRY_DELAY_MS,
    supportsJsonMode: env.GROQ_JSON_MODE,
    supportsEmbeddings: groqEmbeddingModel.length > 0,
  },
  sambanova: {
    name: "sambanova",
    enabled: env.SAMBANOVA_ENABLED && sambanovaApiKey.length > 0,
    apiKey: sambanovaApiKey,
    baseUrl: env.SAMBANOVA_BASE_URL,
    chatModel: sambanovaChatModel,
    extractionModel: sambanovaExtractionModel,
    embeddingModel: sambanovaEmbeddingModel,
    embeddingDimensions: env.SAMBANOVA_EMBEDDING_DIMENSION,
    timeoutMs: env.SAMBANOVA_TIMEOUT_MS,
    maxRetries: env.SAMBANOVA_MAX_RETRIES,
    retryDelayMs: env.SAMBANOVA_RETRY_DELAY_MS,
    supportsJsonMode: env.SAMBANOVA_JSON_MODE,
    supportsEmbeddings: sambanovaEmbeddingModel.length > 0,
  },
  mistral: {
    name: "mistral",
    enabled: env.MISTRAL_ENABLED && mistralApiKey.length > 0,
    apiKey: mistralApiKey,
    baseUrl: env.MISTRAL_BASE_URL,
    chatModel: mistralChatModel,
    extractionModel: mistralExtractionModel,
    embeddingModel: mistralEmbeddingModel,
    embeddingDimensions: env.MISTRAL_EMBEDDING_DIMENSION,
    timeoutMs: env.MISTRAL_TIMEOUT_MS,
    maxRetries: env.MISTRAL_MAX_RETRIES,
    retryDelayMs: env.MISTRAL_RETRY_DELAY_MS,
    supportsJsonMode: env.MISTRAL_JSON_MODE,
    supportsEmbeddings: mistralEmbeddingModel.length > 0,
  },
  nvidia: {
    name: "nvidia",
    enabled: env.NVIDIA_ENABLED && nvidiaApiKey.length > 0,
    apiKey: nvidiaApiKey,
    baseUrl: env.NVIDIA_BASE_URL,
    chatModel: nvidiaChatModel,
    extractionModel: nvidiaExtractionModel,
    embeddingModel: nvidiaEmbeddingModel,
    embeddingDimensions: env.NVIDIA_EMBEDDING_DIMENSION,
    timeoutMs: env.NVIDIA_TIMEOUT_MS,
    maxRetries: env.NVIDIA_MAX_RETRIES,
    retryDelayMs: env.NVIDIA_RETRY_DELAY_MS,
    supportsJsonMode: env.NVIDIA_JSON_MODE,
    supportsEmbeddings: nvidiaEmbeddingModel.length > 0,
  },
  ollama: {
    name: "ollama",
    enabled: env.OLLAMA_ENABLED,
    baseUrl: env.OLLAMA_BASE_URL,
    chatModel: env.OLLAMA_CHAT_MODEL,
    extractionModel: env.OLLAMA_CHAT_MODEL,
    embeddingModel: env.OLLAMA_EMBEDDING_MODEL,
    embeddingDimensions: env.EMBEDDING_DIMENSION,
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    retryDelayMs: env.AI_RETRY_DELAY_MS,
    supportsJsonMode: false,
    supportsEmbeddings: env.OLLAMA_EMBEDDING_MODEL.length > 0,
  },
  openai: {
    name: "openai",
    enabled: env.OPENAI_API_KEY.length > 0,
    apiKey: env.OPENAI_API_KEY,
    baseUrl: env.OPENAI_BASE_URL,
    chatModel: "",
    extractionModel: "",
    embeddingModel: "",
    embeddingDimensions: env.EMBEDDING_DIMENSION,
    timeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    retryDelayMs: env.AI_RETRY_DELAY_MS,
    supportsJsonMode: false,
    supportsEmbeddings: false,
  },
};

const preferredProviderOrder = [
  "google",
  "sambanova",
  "mistral",
  "groq",
  "nvidia",
  "bedrock",
  "ollama",
];

const availableProviders = preferredProviderOrder.filter(
  (name) => (providerDefinitions as any)[name]?.enabled
);

const requestedDefault = normalizeProviderName(env.AI_DEFAULT_PROVIDER);

const defaultProvider =
  requestedDefault && availableProviders.includes(requestedDefault)
    ? requestedDefault
    : availableProviders[0] ?? "bedrock";

const requestedFallbacks = env.AI_FALLBACK_PROVIDERS.filter(
  (name) => availableProviders.includes(name) && name !== defaultProvider
);

const fallbackProviders =
  requestedFallbacks.length > 0
    ? requestedFallbacks
    : availableProviders.filter((name) => name !== defaultProvider);

function providerChatModel(provider: string): string {
  switch (provider) {
    case "bedrock":
      return bedrockChatModelId;
    case "google":
      return googleChatModel;
    case "groq":
      return groqChatModel;
    case "sambanova":
      return sambanovaChatModel;
    case "mistral":
      return mistralChatModel;
    case "nvidia":
      return nvidiaChatModel;
    case "ollama":
      return env.OLLAMA_CHAT_MODEL;
    default:
      return "";
  }
}

function providerExtractionModel(provider: string): string {
  switch (provider) {
    case "bedrock":
      return bedrockExtractionModelId;
    case "google":
      return googleExtractionModel;
    case "groq":
      return groqExtractionModel;
    case "sambanova":
      return sambanovaExtractionModel;
    case "mistral":
      return mistralExtractionModel;
    case "nvidia":
      return nvidiaExtractionModel;
    case "ollama":
      return env.OLLAMA_CHAT_MODEL;
    default:
      return "";
  }
}

function providerEmbeddingModel(provider: string): string {
  switch (provider) {
    case "bedrock":
      return bedrockEmbeddingModelId;
    case "google":
      return googleEmbeddingModel;
    case "groq":
      return groqEmbeddingModel;
    case "sambanova":
      return sambanovaEmbeddingModel;
    case "mistral":
      return mistralEmbeddingModel;
    case "nvidia":
      return nvidiaEmbeddingModel;
    case "ollama":
      return env.OLLAMA_EMBEDDING_MODEL;
    default:
      return "";
  }
}

function firstAvailableModel(task: "chat" | "extraction" | "embedding"): string {
  for (const provider of availableProviders) {
    const modelId =
      task === "chat"
        ? providerChatModel(provider)
        : task === "extraction"
        ? providerExtractionModel(provider)
        : providerEmbeddingModel(provider);

    if (modelId) {
      return buildModelUri(
        provider,
        modelId,
        provider === "bedrock" ? env.BEDROCK_REGION : undefined
      );
    }
  }

  return "";
}

const chatModel =
  env.AI_CHAT_MODEL ||
  firstAvailableModel("chat") ||
  buildModelUri("bedrock", bedrockChatModelId, env.BEDROCK_REGION);

const extractionModel =
  env.AI_EXTRACTION_MODEL ||
  firstAvailableModel("extraction") ||
  chatModel;

let embeddingModel = env.AI_EMBEDDING_MODEL || firstAvailableModel("embedding");

if (!embeddingModel) {
  embeddingModel = buildModelUri(
    "bedrock",
    bedrockEmbeddingModelId,
    env.BEDROCK_REGION
  );
}

const config = {
  server: {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    isProduction: env.NODE_ENV === "production",
    isDevelopment: env.NODE_ENV === "development",
    corsOrigin: env.CORS_ORIGIN,
  },

  cockroach: {
    connectionString: env.COCKROACH_CONNECTION_STRING,
    poolMax: env.DB_POOL_MAX,
    maxConnections: env.DB_MAX_CONNECTIONS,
    idleTimeoutMs: env.DB_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  },

  bedrock: {
    enabled: env.BEDROCK_ENABLED && bedrockHasKeys,
    region: env.BEDROCK_REGION,
    modelId: bedrockChatModelId,
    extractionModelId: bedrockExtractionModelId,
    embeddingModelId: bedrockEmbeddingModelId,
    requestTimeoutMs: env.BEDROCK_REQUEST_TIMEOUT_MS,
    maxTokens: env.BEDROCK_MAX_TOKENS,
  },

  aws: {
    region: env.AWS_REGION,
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },

  s3: {
    bucketName: env.S3_BUCKET_NAME,
  },

  ai: {
    defaultProvider,
    fallbackProviders,
    strictMode: env.AI_STRICT_MODE,
    requestTimeoutMs: env.AI_REQUEST_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    retryDelayMs: env.AI_RETRY_DELAY_MS,
    providerCooldownMs: env.AI_PROVIDER_COOLDOWN_MS,
    minConceptsTiny: env.AI_MIN_CONCEPTS_TINY,
    minConceptsSmall: env.AI_MIN_CONCEPTS_SMALL,
    minConceptsLarge: env.AI_MIN_CONCEPTS_LARGE,
    largeDocumentWords: env.AI_LARGE_DOCUMENT_WORDS,

    models: {
      chat: chatModel,
      extraction: extractionModel,
      embedding: embeddingModel,
    },

    providers: providerDefinitions,
  },

  memory: {
    maxContextMemories: env.MAX_CONTEXT_MEMORIES,
    chunkTargetMin: env.MIN_CHUNK_TOKENS,
    chunkTargetMax: env.MAX_CHUNK_TOKENS,
    defaultDecayRate: env.DEFAULT_DECAY_RATE,
    strongThreshold: env.STRONG_THRESHOLD,
    fadingThreshold: env.FADING_THRESHOLD,
    criticalThreshold: env.CRITICAL_THRESHOLD,
    forgottenThreshold: env.FORGOTTEN_THRESHOLD,
  },

  decay: {
    defaultRate: env.DEFAULT_DECAY_RATE,
    highImportanceRate: env.HIGH_IMPORTANCE_DECAY_RATE,
    lowImportanceRate: env.LOW_IMPORTANCE_DECAY_RATE,
    strongThreshold: env.STRONG_THRESHOLD,
    fadingThreshold: env.FADING_THRESHOLD,
    criticalThreshold: env.CRITICAL_THRESHOLD,
    forgottenThreshold: env.FORGOTTEN_THRESHOLD,
    retainWeight: env.RETAIN_WEIGHT,
    accessBoostWeight: env.ACCESS_BOOST_WEIGHT,
  },

  embedding: {
    dimension: env.EMBEDDING_DIMENSION,
    concurrency: env.EMBEDDING_CONCURRENCY,
    textMaxLength: env.EMBEDDING_TEXT_MAX_LENGTH,
  },

  extraction: {
    modelId: bedrockExtractionModelId,
    maxTokens: env.EXTRACTION_MAX_OUTPUT_TOKENS || env.BEDROCK_EXTRACTION_MAX_TOKENS,
    temperature: env.BEDROCK_EXTRACTION_TEMPERATURE,
    embeddingConcurrency: env.EMBEDDING_CONCURRENCY,
    maxDocumentTokens: env.MAX_DOCUMENT_TOKENS_SINGLE_CALL,
    maxConceptsPerDocument: env.MAX_CONCEPTS_PER_DOCUMENT,
    minConceptImportance: env.MIN_CONCEPT_IMPORTANCE,
    retryCount: env.EXTRACTION_RETRY_COUNT,
    retryDelayMs: env.EXTRACTION_RETRY_DELAY_MS,
    existingMemoryLimit: env.EXTRACTION_EXISTING_MEMORY_LIMIT,
    maxRelatedPerConcept: env.EXTRACTION_MAX_RELATED_PER_CONCEPT,
    sectionConcurrency: env.EXTRACTION_SECTION_CONCURRENCY,
    sectionCharCap: env.EXTRACTION_SECTION_CHAR_CAP,
    singleCallCharThreshold: env.EXTRACTION_SINGLE_CALL_CHAR_THRESHOLD,
    minSectionChars: env.EXTRACTION_MIN_SECTION_CHARS,
    maxSections: env.EXTRACTION_MAX_SECTIONS,
  },

  auth: {
    bcryptRounds: env.BCRYPT_ROUNDS,
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN,
    jwtRefreshExpiresIn: env.JWT_REFRESH_EXPIRES_IN,
    devBypassAuth: env.DEV_BYPASS_AUTH,
    devBypassToken: env.DEV_BYPASS_TOKEN,
    devBypassEmail: env.DEV_BYPASS_EMAIL,
  },

  cors: {
    origin: env.CORS_ORIGIN,
    frontendUrl: env.CORS_FRONTEND_URL,
  },

  scorer: {
    semanticWeight: env.SCORER_SEMANTIC_WEIGHT,
    strengthWeight: env.SCORER_STRENGTH_WEIGHT,
    recencyWeight: env.SCORER_RECENCY_WEIGHT,
    recencyDecayFactor: env.SCORER_RECENCY_DECAY_FACTOR,
    tieBreakThreshold: env.SCORER_TIE_BREAK_THRESHOLD,
    connectivityWeight: env.CONNECTIVITY_SCORE_WEIGHT,
  },

  reminder: {
    checkIntervalHours: env.REMINDER_CHECK_INTERVAL_HOURS,
    minImportance: env.REMINDER_MIN_IMPORTANCE,
    maxTopicsShown: env.REMINDER_MAX_TOPICS_SHOWN,
  },

  relationship: {
    crossChunkConfidence: env.RELATIONSHIP_CROSS_CHUNK_CONFIDENCE,
    similarityMin: env.RELATIONSHIP_SIMILARITY_MIN,
    similarityMax: env.RELATIONSHIP_SIMILARITY_MAX,
  },

  correlation: {
    enabled: env.CORRELATION_ENABLED,
    minSimilarity: env.CORRELATION_MIN_SIMILARITY,
    strongSimilarity: env.CORRELATION_STRONG_SIMILARITY,
    maxLinksPerConcept: env.CORRELATION_MAX_LINKS_PER_CONCEPT,
    maxEdgesPerDocument: env.CORRELATION_MAX_EDGES_PER_DOCUMENT,
    documentTopN: env.CORRELATION_DOCUMENT_TOP_N,
    connectivityScoreWeight: env.CONNECTIVITY_SCORE_WEIGHT,
    aiRelationshipTypingEnabled: env.AI_RELATIONSHIP_TYPING_ENABLED,
    aiRelationshipTypingMaxCalls: env.AI_RELATIONSHIP_TYPING_MAX_CALLS,
  },

  conversation: {
    idleTimeoutMs: env.CONVERSATION_IDLE_TIMEOUT_MS,
  },

  logging: {
    level: env.LOG_LEVEL,
  },
};

export default config;