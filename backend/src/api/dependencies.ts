import { BedrockClient } from "../agent/bedrock-client";
import { ModelRouter, OllamaProvider } from "../agent/model-router";
import type { AIProvider } from "../agent/ai-provider";
import { PromptBuilder } from "../agent/prompt-builder";
import { buildProviderRegistry, getProviderOrder } from "../agent/provider-registry";
import { checkProviderHealth } from "../agent/provider-health";
import { BucketStore } from "../storage/bucket-store";
import { EmbeddingStore } from "../storage/embedding-store";
import { RelationshipStore } from "../storage/relationship-store";
import { RawStore } from "../storage/raw-store";
import { SessionStore } from "../storage/session-store";
import { UserStore } from "../storage/user-store";
import { S3StorageClient } from "../storage/s3-client";
import { DecayEngine } from "../memory/decay";
import { StrengthTracker } from "../memory/strength-tracker";
import { ForgettingBudget } from "../memory/forgetting-budget";
import { ReminderEngine } from "../memory/reminder-engine";
import { Scanner } from "../memory/scanner";
import { TextNormalizer } from "../ingestion/normalizer";
import { ConceptExtractor } from "../ingestion/extractor";
import { RelationshipMapper } from "../ingestion/relationship-mapper";
import { EmbeddingGenerator } from "../ingestion/embedding-generator";
import { IngestionPipeline } from "../ingestion/pipeline";
import { CorrelationEngine } from "../ingestion/correlation-engine";
import { QueryAnalyzer } from "../injection/query-analyzer";
import { Retriever } from "../injection/retriever";
import { Scorer } from "../injection/scorer";
import { Assembler } from "../injection/assembler";
import { queryMany } from "../database";
import config from "../config";
import logger from "../utils/logger";

export interface Dependencies {
  bedrockClient: BedrockClient;
  modelRouter: ModelRouter;
  aiProviders: Record<string, AIProvider>;
  providerOrder: string[];
  checkAIHealth: () => Promise<any>;
  promptBuilder: PromptBuilder;
  bucketStore: BucketStore;
  embeddingStore: EmbeddingStore;
  relationshipStore: RelationshipStore;
  rawStore: RawStore;
  sessionStore: SessionStore;
  userStore: UserStore;
  s3Client: S3StorageClient;
  decayEngine: DecayEngine;
  strengthTracker: StrengthTracker;
  forgettingBudget: ForgettingBudget;
  reminderEngine: ReminderEngine;
  scanner: Scanner;
  normalizer: TextNormalizer;
  extractor: ConceptExtractor;
  relationshipMapper: RelationshipMapper;
  embeddingGenerator: EmbeddingGenerator;
  ingestionPipeline: IngestionPipeline;
  correlationEngine: CorrelationEngine;
  queryAnalyzer: QueryAnalyzer;
  retriever: Retriever;
  scorer: Scorer;
  assembler: Assembler;
}

let deps: Dependencies | null = null;

export function initializeDependencies(): Dependencies {
  if (deps) {
    return deps;
  }

  logger.info("Initializing dependencies");

  const bedrockClient = new BedrockClient();

  const baseProviders: Record<string, AIProvider> = {
    bedrock: bedrockClient,
  };

  if ((config.ai.providers as any)?.ollama?.enabled) {
    baseProviders.ollama = new OllamaProvider();
  }

  const aiProviders = buildProviderRegistry(baseProviders);
  const providerOrder = getProviderOrder(aiProviders);

  const modelRouter = new ModelRouter({ providers: aiProviders });

  const checkAIHealth = () =>
    checkProviderHealth(aiProviders, {
      names: providerOrder,
      timeoutMs: 5000,
    });

  const promptBuilder = new PromptBuilder();

  const bucketStore = new BucketStore();
  const embeddingStore = new EmbeddingStore();
  const relationshipStore = new RelationshipStore();
  const rawStore = new RawStore();
  const sessionStore = new SessionStore();
  const userStore = new UserStore();
  const s3Client = new S3StorageClient();

  const decayEngine = new DecayEngine();
  const strengthTracker = new StrengthTracker(decayEngine);
  const forgettingBudget = new ForgettingBudget();
  const reminderEngine = new ReminderEngine();
  const scanner = new Scanner(decayEngine, strengthTracker, reminderEngine);

  const normalizer = new TextNormalizer();
  const extractor = new ConceptExtractor();
  const embeddingGenerator = new EmbeddingGenerator(modelRouter as any);

  const relationshipMapper = new RelationshipMapper(
    relationshipStore as any,
    bucketStore as any
  );

  const ingestionPipeline = new IngestionPipeline({
    normalizer,
    extractor,
    relationshipMapper,
    embeddingGenerator,
    rawStore: rawStore as any,
    bucketStore: bucketStore as any,
    embeddingStore: embeddingStore as any,
    aiClient: modelRouter as any,
  });

  const correlationEngine = new CorrelationEngine({
    embeddingStore,
    relationshipStore,
  });

  const queryAnalyzer = new QueryAnalyzer(modelRouter as any);

  const graphSearcher = {
    getBySource: async (source: string) => {
      try {
        const rows = await queryMany<{
          target_bucket: string;
          relation_type: string;
          confidence: number;
        }>(
          `SELECT b2.bucket_id AS target_bucket,
                  r.relation_type,
                  r.confidence
           FROM relationships r
           JOIN buckets b1 ON b1.canonical = r.source_bucket
           JOIN buckets b2 ON b2.canonical = r.target_bucket
           WHERE b1.bucket_id = $1 AND b2.bucket_id <> $1`,
          [source]
        );

        return rows.map((r) => ({
          source_bucket: source,
          target_bucket: r.target_bucket,
          relation_type: r.relation_type,
          confidence: r.confidence,
        }));
      } catch (error) {
        logger.debug("graph getBySource failed", {
          source,
          error: (error as Error).message,
        });
        return [];
      }
    },
    getByTarget: async (target: string) => {
      try {
        const rows = await queryMany<{
          source_bucket: string;
          relation_type: string;
          confidence: number;
        }>(
          `SELECT b1.bucket_id AS source_bucket,
                  r.relation_type,
                  r.confidence
           FROM relationships r
           JOIN buckets b1 ON b1.canonical = r.source_bucket
           JOIN buckets b2 ON b2.canonical = r.target_bucket
           WHERE b2.bucket_id = $1 AND b1.bucket_id <> $1`,
          [target]
        );

        return rows.map((r) => ({
          source_bucket: r.source_bucket,
          target_bucket: target,
          relation_type: r.relation_type,
          confidence: r.confidence,
        }));
      } catch (error) {
        logger.debug("graph getByTarget failed", {
          target,
          error: (error as Error).message,
        });
        return [];
      }
    },
  } as any;

  const retriever = new Retriever({
    embeddingSearcher: {
      generateEmbedding: modelRouter.generateEmbedding.bind(modelRouter),
      searchSimilar: embeddingStore.searchSimilar.bind(embeddingStore),
      searchSimilarWithinDocument: (embeddingStore as any)
        .searchSimilarWithinDocument
        ? (embeddingStore as any).searchSimilarWithinDocument.bind(
          embeddingStore
        )
        : undefined,
    } as any,
    textSearcher: bucketStore,
    graphSearcher,
  });

  const scorer = new Scorer();
  const assembler = new Assembler(forgettingBudget);

  deps = {
    bedrockClient,
    modelRouter,
    aiProviders,
    providerOrder,
    checkAIHealth,
    promptBuilder,
    bucketStore,
    embeddingStore,
    relationshipStore,
    rawStore,
    sessionStore,
    userStore,
    s3Client,
    decayEngine,
    strengthTracker,
    forgettingBudget,
    reminderEngine,
    scanner,
    normalizer,
    extractor,
    relationshipMapper,
    embeddingGenerator,
    ingestionPipeline,
    correlationEngine,
    queryAnalyzer,
    retriever,
    scorer,
    assembler,
  };

  logger.info("All dependencies initialized", {
    providerOrder,
    defaultProvider: config.ai.defaultProvider,
    fallbackProviders: config.ai.fallbackProviders,
  });

  return deps;
}

export function getDependencies(): Dependencies {
  if (!deps) {
    throw new Error(
      "Dependencies not initialized. Call initializeDependencies() first."
    );
  }
  return deps;
}

export function resetDependencies(): void {
  deps = null;
  logger.info("Dependencies reset");
}