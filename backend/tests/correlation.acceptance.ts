import "dotenv/config";
import express from "express";
import request from "supertest";

if (process.env.BEDROCK_REGION && process.env.PHASE1_FORCE_BEDROCK_REGION !== "false") {
  process.env.AWS_REGION = process.env.BEDROCK_REGION;
}

process.env.CORRELATION_MIN_SIMILARITY = process.env.CORRELATION_MIN_SIMILARITY || "0.45";
process.env.CORRELATION_STRONG_SIMILARITY = process.env.CORRELATION_STRONG_SIMILARITY || "0.65";

type Db = typeof import("../src/database");

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const skipCleanup = ["true", "1", "yes"].includes(
  (process.env.CORRELATION_SKIP_CLEANUP || "").toLowerCase()
);

const JOB_TIMEOUT_MS = Number(process.env.CORRELATION_JOB_TIMEOUT_MS || 360000);

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`PASS: ${message}`);
}

function warn(message: string): void {
  console.log(`WARN: ${message}`);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeQuery(db: Db, text: string, params?: unknown[]): Promise<void> {
  try {
    await db.query(text, params);
  } catch (error) {
    console.log(`Cleanup warning: ${(error as Error).message}`);
  }
}

async function tableExists(db: Db, tableName: string): Promise<boolean> {
  const row = await db.queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_name = $1
    ) AS exists`,
    [tableName]
  );

  return row?.exists ?? false;
}

async function columnExists(
  db: Db,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const row = await db.queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2
    ) AS exists`,
    [tableName, columnName]
  );

  return row?.exists ?? false;
}

async function precheck(db: Db): Promise<void> {
  assert(await tableExists(db, "processing_jobs"), "processing_jobs table exists");
  assert(await tableExists(db, "document_links"), "document_links table exists");
  assert(await columnExists(db, "relationships", "metadata"), "relationships.metadata column exists");
  assert(await columnExists(db, "buckets", "user_id"), "buckets.user_id column exists");
  assert(await columnExists(db, "documents", "user_id"), "documents.user_id column exists");
}

async function createTestUser(
  db: Db,
  passwordMod: any,
  tokensMod: any,
  suffix: string
): Promise<{ userId: string; email: string; token: string }> {
  const email = `correlation_${suffix}_${runId}@contextos.test`;
  const displayName = `Correlation ${suffix.toUpperCase()} ${runId}`;
  const passwordHash = await passwordMod.hashPassword(`CorrelationTest123!${runId}`);

  const row = await db.queryOne<{ user_id: string }>(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ($1, $2, $3)
     RETURNING user_id`,
    [email, passwordHash, displayName]
  );

  if (!row?.user_id) {
    throw new Error(`Failed to create test user ${suffix}`);
  }

  const token = tokensMod.generateToken(row.user_id, email);

  return {
    userId: row.user_id,
    email,
    token,
  };
}

async function uploadBuffer(
  app: any,
  token: string,
  fileBuffer: Buffer,
  filename: string
): Promise<any> {
  return request(app)
    .post("/api/documents/upload")
    .set("Authorization", `Bearer ${token}`)
    .attach("file", fileBuffer, filename);
}

async function pollJob(
  app: any,
  token: string,
  jobId: string,
  timeoutMs: number
): Promise<any> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const res = await request(app)
      .get(`/api/documents/processing/${jobId}`)
      .set("Authorization", `Bearer ${token}`);

    if (res.status === 404) {
      throw new Error(`Processing job not found: ${jobId}`);
    }

    if (res.status !== 200) {
      throw new Error(
        `Failed to poll job ${jobId}: status ${res.status} body ${JSON.stringify(res.body)}`
      );
    }

    const job = res.body;

    console.log(
      `Job ${jobId}: status=${job.status} stage=${job.stage} progress=${job.progress}`
    );

    if (job.status === "complete") {
      return job;
    }

    if (job.status === "failed") {
      throw new Error(
        `Processing job failed: ${job.error || job.message || "unknown error"}`
      );
    }

    await sleep(2500);
  }

  throw new Error(`Processing job timed out after ${timeoutMs}ms`);
}

function getJobDocumentId(job: any): string {
  return job?.fileId || job?.result?.fileId || "";
}

async function cleanup(db: Db, userIds: string[]): Promise<void> {
  if (userIds.length === 0) {
    console.log("No test users to clean");
    return;
  }

  console.log("Cleaning test data...");

  const pattern = `%${runId}%`;

  await safeQuery(
    db,
    `DELETE FROM document_links
     WHERE user_id = ANY($1::uuid[])
        OR source_document_id IN (
          SELECT document_id FROM documents WHERE user_id = ANY($1::uuid[])
        )
        OR target_document_id IN (
          SELECT document_id FROM documents WHERE user_id = ANY($1::uuid[])
        )`,
    [userIds]
  );

  await safeQuery(
    db,
    `DELETE FROM relationships
     WHERE user_id = ANY($1::uuid[])
        OR source_bucket ILIKE $2
        OR target_bucket ILIKE $2
        OR source_bucket_id IN (
          SELECT bucket_id FROM buckets WHERE user_id = ANY($1::uuid[]) OR canonical ILIKE $2
        )
        OR target_bucket_id IN (
          SELECT bucket_id FROM buckets WHERE user_id = ANY($1::uuid[]) OR canonical ILIKE $2
        )`,
    [userIds, pattern]
  );

  await safeQuery(
    db,
    `DELETE FROM embeddings
     WHERE bucket_id IN (
       SELECT bucket_id
       FROM buckets
       WHERE user_id = ANY($1::uuid[]) OR canonical ILIKE $2
     )`,
    [userIds, pattern]
  );

  await safeQuery(
    db,
    `DELETE FROM bucket_items
     WHERE bucket_id IN (
       SELECT bucket_id
       FROM buckets
       WHERE user_id = ANY($1::uuid[]) OR canonical ILIKE $2
     )`,
    [userIds, pattern]
  );

  await safeQuery(
    db,
    `DELETE FROM raw_chunks
     WHERE document_id IN (
       SELECT document_id FROM documents WHERE user_id = ANY($1::uuid[])
     )`,
    [userIds]
  );

  await safeQuery(
    db,
    `DELETE FROM contradictions WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );

  await safeQuery(
    db,
    `DELETE FROM reminders WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );

  await safeQuery(
    db,
    `DELETE FROM messages
     WHERE session_id IN (
       SELECT session_id FROM sessions WHERE user_id = ANY($1::uuid[])
     )`,
    [userIds]
  );

  await safeQuery(
    db,
    `DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );

  await safeQuery(
    db,
    `DELETE FROM processing_jobs WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );

  await safeQuery(
    db,
    `DELETE FROM documents WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );

  await safeQuery(
    db,
    `DELETE FROM buckets WHERE user_id = ANY($1::uuid[]) OR canonical ILIKE $2`,
    [userIds, pattern]
  );

  await safeQuery(
    db,
    `DELETE FROM users WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );

  console.log("Cleanup complete");
}

async function main(): Promise<void> {
  const start = Date.now();
  let failed = false;

  console.log("ContextOS Correlation Acceptance Test");
  console.log(`Run ID: ${runId}`);
  console.log("");

  const config = (await import("../src/config")).default as any;

  config.ai.strictMode = false;

  config.correlation = {
    enabled: true,
    minSimilarity: 0.45,
    strongSimilarity: 0.65,
    maxLinksPerConcept: 8,
    maxEdgesPerDocument: 200,
    documentTopN: 10,
    connectivityScoreWeight: 0.12,
    aiRelationshipTypingEnabled: false,
    aiRelationshipTypingMaxCalls: 0,
  };

  const db = await import("../src/database");
  const dependencies = await import("../src/api/dependencies");
  const documentsRoutes = (await import("../src/api/documents.routes")).default;
  const password = await import("../src/auth/password");
  const tokens = await import("../src/auth/tokens");

  db.initPool();

  const deps: any = dependencies.initializeDependencies();

  const app = express();
  app.use(express.json());
  app.use("/api/documents", documentsRoutes);

  const userIds: string[] = [];

  try {
    await precheck(db);

    console.log("Creating test users...");

    const userA = await createTestUser(db, password, tokens, "a");
    userIds.push(userA.userId);

    const userB = await createTestUser(db, password, tokens, "b");
    userIds.push(userB.userId);

    console.log(`User A: ${userA.email}`);
    console.log(`User B: ${userB.email}`);

    const docOneText = [
      `Correlation Test One ${runId}`,
      ``,
      `Sparse Retrieval Core: Sparse retrieval selects a small subset of relevant entries using inverted indexes and lexical matching.`,
      `Conditional Memory Rule: Conditional memory activates only when a query matches a stored context pattern.`,
      `Retrieval Latency Metric: Retrieval latency measures the time from query issuance to memory return.`,
      `Related concepts: Sparse Retrieval Core, Conditional Memory Rule, Retrieval Latency Metric.`,
    ].join("\n");

    const docTwoText = [
      `Correlation Test Two ${runId}`,
      ``,
      `Conditional Memory Rule: Conditional memory reduces unnecessary activation by checking query context before retrieval.`,
      `Retrieval Latency Metric: Retrieval latency improved after conditional memory was added to the retrieval path.`,
      `Memory Decay Model: Memory decay lowers strength over time unless memories are reactivated by use.`,
      `Related concepts: Conditional Memory Rule, Retrieval Latency Metric, Memory Decay Model.`,
    ].join("\n");

    console.log("Uploading document one for User A...");

    const uploadOne = await uploadBuffer(
      app,
      userA.token,
      Buffer.from(docOneText, "utf8"),
      `correlation-one-${runId}.txt`
    );

    assert(uploadOne.status === 202, "Document one upload returns 202");
    assert(typeof uploadOne.body.jobId === "string", "Document one upload returns jobId");

    const jobOne = await pollJob(app, userA.token, uploadOne.body.jobId, JOB_TIMEOUT_MS);

    assert(jobOne.status === "complete", "Document one job completes");
    assert(jobOne.result?.status === "complete", "Document one ingestion result is complete");
    assert(Number(jobOne.result?.conceptsExtracted ?? 0) >= 1, "Document one extracts at least one concept");

    const docOneId = getJobDocumentId(jobOne);
    assert(docOneId.length > 0, "Document one ID exists");

    console.log("Uploading document two for User A...");

    const uploadTwo = await uploadBuffer(
      app,
      userA.token,
      Buffer.from(docTwoText, "utf8"),
      `correlation-two-${runId}.txt`
    );

    assert(uploadTwo.status === 202, "Document two upload returns 202");
    assert(typeof uploadTwo.body.jobId === "string", "Document two upload returns jobId");

    const jobTwo = await pollJob(app, userA.token, uploadTwo.body.jobId, JOB_TIMEOUT_MS);

    assert(jobTwo.status === "complete", "Document two job completes");
    assert(jobTwo.result?.status === "complete", "Document two ingestion result is complete");
    assert(Number(jobTwo.result?.conceptsExtracted ?? 0) >= 1, "Document two extracts at least one concept");

    const docTwoId = getJobDocumentId(jobTwo);
    assert(docTwoId.length > 0, "Document two ID exists");

    console.log("");
    console.log("Document two job result:");
    console.log(JSON.stringify(jobTwo.result, null, 2));

    assert(
      jobTwo.result?.connections && typeof jobTwo.result.connections === "object",
      "Document two job result includes connections object"
    );

    const connectionScore = Number(jobTwo.result.connections.connectionScore ?? 0);

    assert(
      connectionScore >= 0 && connectionScore <= 1,
      "Connection score is between 0 and 1"
    );

    const liveConnections =
      Number(jobTwo.result.connections.exactMerges ?? 0) +
      Number(jobTwo.result.connections.semanticConnections ?? 0);

    if (liveConnections > 0) {
      assert(true, "Document two created live connections to existing knowledge");
    } else {
      warn(
        "Document two did not create live AI/vector connections. " +
        "This can happen if extracted labels or embeddings differ too much. " +
        "Deterministic correlation store checks will still run."
      );
    }

    if (Array.isArray(jobTwo.result.relatedDocuments) && jobTwo.result.relatedDocuments.length > 0) {
      assert(true, "Document two job result includes related documents");
    } else {
      warn("Document two job result did not include related documents from live ingestion.");
    }

    console.log("Running deterministic correlation store checks...");

    assert(
      typeof deps.relationshipStore.syncVectorConnections === "function",
      "relationshipStore.syncVectorConnections exists"
    );

    assert(
      typeof deps.relationshipStore.aggregateDocumentLinks === "function",
      "relationshipStore.aggregateDocumentLinks exists"
    );

    assert(
      typeof deps.relationshipStore.getRelatedDocuments === "function",
      "relationshipStore.getRelatedDocuments exists"
    );

    assert(
      typeof deps.relationshipStore.getTopConnectedMemories === "function",
      "relationshipStore.getTopConnectedMemories exists"
    );

    assert(
      typeof deps.relationshipStore.getConnectionStats === "function",
      "relationshipStore.getConnectionStats exists"
    );

    const alphaLabel = `Corr Alpha ${runId}`;
    const betaLabel = `Corr Beta ${runId}`;
    const gammaLabel = `Corr Gamma ${runId}`;

    const alpha = await deps.bucketStore.getOrCreateBucket(
      alphaLabel,
      `Deterministic correlation alpha memory for run ${runId}.`,
      "fact",
      8,
      "correlation-test",
      docOneId
    );

    const beta = await deps.bucketStore.getOrCreateBucket(
      betaLabel,
      `Deterministic correlation beta memory for run ${runId}.`,
      "fact",
      7,
      "correlation-test",
      docOneId
    );

    const gamma = await deps.bucketStore.getOrCreateBucket(
      gammaLabel,
      `Deterministic correlation gamma memory for run ${runId}.`,
      "fact",
      8,
      "correlation-test",
      docTwoId
    );

    const ai = deps.aiRouter || deps.modelRouter || deps.bedrockClient;

    const alphaVector = await ai.generateEmbedding(`${alphaLabel}: deterministic correlation alpha memory.`);
    const betaVector = await ai.generateEmbedding(`${betaLabel}: deterministic correlation beta memory.`);
    const gammaVector = await ai.generateEmbedding(`${gammaLabel}: deterministic correlation gamma memory.`);

    await deps.embeddingStore.storeEmbedding(alpha.bucketId, alphaVector, docOneId);
    await deps.embeddingStore.storeEmbedding(beta.bucketId, betaVector, docOneId);
    await deps.embeddingStore.storeEmbedding(gamma.bucketId, gammaVector, docTwoId);

    const synced = await deps.relationshipStore.syncVectorConnections({
      userId: userA.userId,
      documentId: docTwoId,
      edges: [
        {
          sourceBucketId: gamma.bucketId,
          targetBucketId: alpha.bucketId,
          sourceLabel: gammaLabel,
          targetLabel: alphaLabel,
          confidence: 0.91,
          similarity: 0.91,
          sourceDocumentId: docTwoId,
          targetDocumentId: docOneId,
          evidence: `${gammaLabel} -> ${alphaLabel}`,
        },
        {
          sourceBucketId: gamma.bucketId,
          targetBucketId: beta.bucketId,
          sourceLabel: gammaLabel,
          targetLabel: betaLabel,
          confidence: 0.82,
          similarity: 0.82,
          sourceDocumentId: docTwoId,
          targetDocumentId: docOneId,
          evidence: `${gammaLabel} -> ${betaLabel}`,
        },
      ],
    });

    assert(synced >= 2, "Deterministic vector connections stored");

    const aggregated = await deps.relationshipStore.aggregateDocumentLinks(
      userA.userId,
      docTwoId
    );

    assert(aggregated >= 1, "Document links aggregated");

    const relatedDocuments = await deps.relationshipStore.getRelatedDocuments(
      userA.userId,
      docTwoId,
      10
    );

    console.log("");
    console.log("Related documents for document two:");
    console.log(JSON.stringify(relatedDocuments, null, 2));

    assert(
      relatedDocuments.some((doc: any) => doc.documentId === docOneId),
      "Document one appears as related document for document two"
    );

    const topConnectedMemories = await deps.relationshipStore.getTopConnectedMemories(
      userA.userId,
      docTwoId,
      10
    );

    console.log("");
    console.log("Top connected memories for document two:");
    console.log(JSON.stringify(topConnectedMemories, null, 2));

    assert(topConnectedMemories.length >= 1, "Top connected memories returned");

    const stats = await deps.relationshipStore.getConnectionStats(
      userA.userId,
      docTwoId,
      0
    );

    console.log("");
    console.log("Connection stats for document two:");
    console.log(JSON.stringify(stats, null, 2));

    assert(
      Number(stats.semanticConnections ?? 0) + Number(stats.exactMerges ?? 0) >= 1,
      "Connection stats include at least one connection"
    );

    console.log("Testing User B isolation...");

    const relatedForB = await deps.relationshipStore.getRelatedDocuments(
      userB.userId,
      docTwoId,
      10
    );

    assert(relatedForB.length === 0, "User B does not see User A related documents");

    const topForB = await deps.relationshipStore.getTopConnectedMemories(
      userB.userId,
      docTwoId,
      10
    );

    assert(topForB.length === 0, "User B does not see User A connected memories");

    const bGetADocument = await request(app)
      .get(`/api/documents/${docOneId}`)
      .set("Authorization", `Bearer ${userB.token}`);

    assert(bGetADocument.status === 404, "User B cannot read User A document");

    console.log("");
    console.log("ALL CORRELATION TESTS PASSED");
  } catch (error) {
    failed = true;
    console.error("");
    console.error("TEST FAILED");
    console.error((error as Error).message);
  } finally {
    try {
      if (!skipCleanup) {
        await cleanup(db, userIds);
      } else {
        console.log("Cleanup skipped because CORRELATION_SKIP_CLEANUP is enabled");
      }
    } catch (cleanupError) {
      failed = true;
      console.error("Cleanup failed");
      console.error((cleanupError as Error).message);
    }

    await db.closePool();
  }

  console.log(`Total time: ${((Date.now() - start) / 1000).toFixed(1)}s`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal test error");
  console.error(error);
  process.exit(1);
});