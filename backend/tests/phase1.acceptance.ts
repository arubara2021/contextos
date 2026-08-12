import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import express from "express";
import request from "supertest";

if (process.env.BEDROCK_REGION && process.env.PHASE1_FORCE_BEDROCK_REGION !== "false") {
  process.env.AWS_REGION = process.env.BEDROCK_REGION;
}
type Db = typeof import("../src/database");

const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const testFileArg = process.argv[2] || process.env.TEST_FILE || "";
const skipCleanup = ["true", "1", "yes"].includes(
  (process.env.PHASE1_SKIP_CLEANUP || "").toLowerCase()
);

const SMALL_JOB_TIMEOUT_MS = Number(process.env.PHASE1_JOB_TIMEOUT_MS || 240000);
const PDF_JOB_TIMEOUT_MS = Number(process.env.PHASE1_PDF_TIMEOUT_MS || 900000);

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

function parseJsonArraySafe(input: string): any[] {
  const trimmed = (input || "").trim();

  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed);

    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {}

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);

  if (fenced) {
    try {
      const parsed = JSON.parse(fenced[1].trim());

      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object") return [parsed];
    } catch {}
  }

  const arrayMatch = trimmed.match(/\[[\s\S]*\]/);

  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);

      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  const objectMatches = trimmed.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);

  if (objectMatches && objectMatches.length > 0) {
    const results: any[] = [];

    for (const match of objectMatches) {
      try {
        const parsed = JSON.parse(match);

        if (parsed && typeof parsed === "object") {
          results.push(parsed);
        }
      } catch {}
    }

    if (results.length > 0) return results;
  }

  return [];
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
      SELECT 1 FROM information_schema.tables WHERE table_name = $1
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
  assert(await columnExists(db, "buckets", "user_id"), "buckets.user_id column exists");
  assert(await columnExists(db, "documents", "user_id"), "documents.user_id column exists");
  assert(
    await columnExists(db, "relationships", "source_bucket_id"),
    "relationships.source_bucket_id column exists"
  );
  assert(
    await columnExists(db, "relationships", "target_bucket_id"),
    "relationships.target_bucket_id column exists"
  );
  assert(
    await columnExists(db, "relationships", "user_id"),
    "relationships.user_id column exists"
  );
  assert(
    await columnExists(db, "raw_chunks", "document_id"),
    "raw_chunks.document_id column exists"
  );
}

async function aiPreflight(deps: any, cfg: any): Promise<void> {
  const ai = deps.aiRouter || deps.modelRouter || deps.bedrockClient;

  assert(Boolean(ai), "AI router/client is available");

  if (typeof deps.modelRouter?.health === "function") {
    const health = await deps.modelRouter.health();

    assert(
      health.status !== "unhealthy",
      `AI health is not unhealthy (${health.status})`
    );

    if (health.status === "degraded") {
      warn(`AI health degraded: ${(health.errors || []).join(" | ")}`);
    }
  }

  const dimension = Number(cfg?.embedding?.dimension ?? 1024);

  try {
    const vector = await ai.generateEmbedding("ContextOS phase one health check");

    assert(
      Array.isArray(vector) && vector.length === dimension,
      `AI embedding health returns ${dimension} dimensions`
    );
  } catch (error) {
    throw new Error(
      `AI embedding preflight failed: ${(error as Error).message}. ` +
        "Check AWS credentials, Bedrock embedding model, region, and network."
    );
  }

  const systemPrompt = [
    "You are a strict knowledge extraction system.",
    "Extract concepts from the text as a JSON array.",
    "Each object must have label, definition, type, importance.",
    "Output ONLY valid JSON. No markdown.",
  ].join("\n");

  const userPrompt = [
    "Apollo Caching Decision: The team decided to replace the monolithic cache with a partitioned LRU cache.",
    "Repeated Read Problem: Repeated reads from the primary database caused p99 latency spikes.",
  ].join("\n");

  try {
    const invoke = (ai.sendExtraction || ai.sendMessage).bind(ai);
    const response = await invoke(systemPrompt, userPrompt);
    const parsed = parseJsonArraySafe(response);

    const valid = parsed.filter((item: any) => {
      return (
        item &&
        typeof item === "object" &&
        typeof item.label === "string" &&
        item.label.trim().length > 0 &&
        typeof item.definition === "string" &&
        item.definition.trim().length > 0
      );
    });

    assert(
      valid.length >= 1,
      "AI extraction preflight produces at least one valid concept"
    );
  } catch (error) {
    throw new Error(
      `AI extraction preflight failed: ${(error as Error).message}. ` +
        "If using Bedrock Nova in a region that requires inference profiles, set AI_EXTRACTION_MODEL and AI_CHAT_MODEL " +
        "to the inference profile ID/ARN, or set BEDROCK_REGION/AWS_REGION to a region where the model supports on-demand throughput."
    );
  }
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

    if (job.status === "complete") {
      return job;
    }

    if (job.status === "failed") {
      throw new Error(
        `Processing job failed: ${job.error || job.message || "unknown error"}`
      );
    }

    await sleep(2000);
  }

  throw new Error(`Processing job timed out after ${timeoutMs}ms`);
}

function getJobDocumentId(job: any): string {
  return job?.fileId || job?.result?.fileId || "";
}

function assertNoJobErrors(job: any, label: string): void {
  const errors = job?.result?.errors;

  if (Array.isArray(errors) && errors.length > 0) {
    assert(false, `${label}: job has no errors (${errors.join(" | ")})`);
  }

  assert(true, `${label}: job has no errors`);
}

function assertJobSuccessful(job: any, label: string): void {
  assert(job.status === "complete", `${label}: job status is complete`);
  assert(job.result?.status === "complete", `${label}: ingestion result status is complete`);
  assertNoJobErrors(job, label);
}

function assertConceptCount(job: any, min: number, label: string): void {
  const count = Number(job?.result?.conceptsExtracted ?? 0);

  assert(
    count >= min,
    `${label}: extracted ${count} concepts, required at least ${min}`
  );
}

async function createTestUser(
  db: Db,
  passwordMod: any,
  tokensMod: any,
  suffix: string
): Promise<{ userId: string; email: string; token: string }> {
  const email = `phase1_${suffix}_${runId}@contextos.test`;
  const displayName = `Phase1 ${suffix.toUpperCase()} ${runId}`;
  const passwordHash = await passwordMod.hashPassword(`Phase1Test123!${runId}`);

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

async function countEmbeddingsForDocument(
  db: Db,
  documentId: string,
  userId: string
): Promise<number> {
  const row = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count
     FROM embeddings
     WHERE bucket_id IN (
       SELECT bucket_id FROM buckets WHERE document_id = $1 AND user_id = $2
     )`,
    [documentId, userId]
  );

  return Number(row?.count ?? 0);
}

async function getFirstBucketForDocument(
  db: Db,
  documentId: string,
  userId: string
): Promise<{ bucket_id: string; canonical: string }> {
  const row = await db.queryOne<{ bucket_id: string; canonical: string }>(
    `SELECT bucket_id, canonical
     FROM buckets
     WHERE document_id = $1 AND user_id = $2
     ORDER BY importance DESC, strength DESC, created_at ASC
     LIMIT 1`,
    [documentId, userId]
  );

  if (!row?.bucket_id) {
    throw new Error(`No bucket found for document ${documentId}`);
  }

  return row;
}

async function assertBucketsOwnedBy(
  db: Db,
  bucketIds: string[],
  userId: string,
  label: string
): Promise<void> {
  if (bucketIds.length === 0) {
    assert(true, `${label}: no buckets to check`);
    return;
  }

  const rows = await db.queryMany<{ bucket_id: string; user_id: string | null }>(
    `SELECT bucket_id, user_id
     FROM buckets
     WHERE bucket_id = ANY($1::uuid[])`,
    [bucketIds]
  );

  const found = new Map<string, string | null>();

  for (const row of rows) {
    found.set(row.bucket_id, row.user_id);
  }

  const bad = bucketIds.filter((id) => found.get(id) !== userId);

  assert(
    bad.length === 0,
    `${label}: all ${bucketIds.length} buckets are owned by expected user`
  );
}

async function assertBucketsInDocument(
  db: Db,
  bucketIds: string[],
  documentId: string,
  label: string
): Promise<void> {
  if (bucketIds.length === 0) {
    assert(true, `${label}: no buckets to check`);
    return;
  }

  const rows = await db.queryMany<{ bucket_id: string; document_id: string | null }>(
    `SELECT bucket_id, document_id
     FROM buckets
     WHERE bucket_id = ANY($1::uuid[])`,
    [bucketIds]
  );

  const found = new Map<string, string | null>();

  for (const row of rows) {
    found.set(row.bucket_id, row.document_id);
  }

  const bad = bucketIds.filter((id) => found.get(id) !== documentId);

  assert(
    bad.length === 0,
    `${label}: all ${bucketIds.length} buckets belong to expected document`
  );
}

async function cleanup(
  db: Db,
  deps: any,
  userIds: string[]
): Promise<void> {
  if (userIds.length === 0) {
    console.log("No test users to clean");
    return;
  }

  console.log("Cleaning test data...");

  const pattern = `%${runId}%`;

  try {
    const docs = await db.query(
      `SELECT s3_key
       FROM documents
       WHERE user_id = ANY($1::uuid[]) AND s3_key IS NOT NULL`,
      [userIds]
    );

    if (deps?.s3Client) {
      for (const doc of docs.rows) {
        try {
          const client = deps.s3Client as any;

          if (doc.s3_key && typeof client.delete === "function") {
            await client.delete(doc.s3_key);
          } else if (doc.s3_key && typeof client.deleteObject === "function") {
            await client.deleteObject(doc.s3_key);
          }
        } catch {}
      }
    }
  } catch {}

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

  const docsLeft = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM documents WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );

  const bucketsLeft = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM buckets WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );

  const jobsLeft = await db.queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM processing_jobs WHERE user_id = ANY($1::uuid[])`,
    [userIds]
  );

  assert(Number(docsLeft?.count ?? 0) === 0, "cleanup: no test documents remain");
  assert(Number(bucketsLeft?.count ?? 0) === 0, "cleanup: no test buckets remain");
  assert(Number(jobsLeft?.count ?? 0) === 0, "cleanup: no test jobs remain");

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

  console.log("ContextOS Phase 1 Acceptance Test");
  console.log(`Run ID: ${runId}`);
  console.log(`Test file: ${testFileArg || "none"}`);
  console.log("");

  const db = await import("../src/database");
  const dependencies = await import("../src/api/dependencies");
  const documentsRoutes = (await import("../src/api/documents.routes")).default;
  const password = await import("../src/auth/password");
  const tokens = await import("../src/auth/tokens");
  const extractorMod = await import("../src/ingestion/extractor");
  const embeddingGeneratorMod = await import("../src/ingestion/embedding-generator");
  const config = (await import("../src/config")).default as any;

  const minSmall = Number(
    process.env.PHASE1_MIN_CONCEPTS_SMALL ||
      config?.ai?.minConceptsSmall ||
      3
  );

  const minPdf = Number(
    process.env.PHASE1_MIN_CONCEPTS_PDF ||
      config?.ai?.minConceptsLarge ||
      8
  );

  db.initPool();

  const deps: any = dependencies.initializeDependencies();

  const app = express();
  app.use(express.json());
  app.use("/api/documents", documentsRoutes);

  const userIds: string[] = [];

  try {
    await precheck(db);

    assert(Boolean(config?.ai), "config.ai exists");
    assert(
      typeof config?.ai?.models?.extraction === "string" &&
        config.ai.models.extraction.length > 0,
      "config.ai.models.extraction is configured"
    );
    assert(
      typeof config?.ai?.models?.embedding === "string" &&
        config.ai.models.embedding.length > 0,
      "config.ai.models.embedding is configured"
    );

    console.log("AI preflight...");
    await aiPreflight(deps, config);

    console.log("Extractor validation checks...");

    const extractor = new extractorMod.ConceptExtractor();

    const malformed = extractor.parseAndValidateConcepts("not valid json", "test");
    assert(malformed.length === 0, "extractor rejects malformed JSON safely");

    const lowQuality = extractor.parseAndValidateConcepts(
      JSON.stringify([
        {
          label: "it",
          definition: "short",
          type: "fact",
          importance: 9,
        },
      ]),
      "test"
    );

    assert(lowQuality.length === 0, "extractor rejects low-quality concepts");

    const maxConcepts = Number(config?.extraction?.maxConceptsPerDocument || 80);

    const tooMany = Array.from({ length: maxConcepts + 20 }, (_, i) => ({
      label: `Phase1 Valid Concept ${i} ${runId}`,
      definition: `This is a valid phase one test definition number ${i} for run ${runId}.`,
      type: "fact",
      importance: 7,
    }));

    const bounded = extractor.parseAndValidateConcepts(
      JSON.stringify(tooMany),
      "test"
    );

    assert(
      bounded.length <= maxConcepts,
      `extractor enforces max concepts limit (${bounded.length} <= ${maxConcepts})`
    );

    console.log("Embedding validation checks...");

    const fakeClient = {
      generateEmbedding: async () => [] as number[],
    };

    const generator = new embeddingGeneratorMod.EmbeddingGenerator(fakeClient);
    const dimension = Number(config?.embedding?.dimension ?? 1024);

    assert(
      !generator.validateEmbedding(new Array(dimension + 1).fill(0.1)),
      "embedding generator rejects wrong dimension"
    );

    assert(
      !generator.validateEmbedding(new Array(dimension).fill(0)),
      "embedding generator rejects all-zero vector"
    );

    const nonFinite = new Array(dimension).fill(0.1);
    nonFinite[7] = NaN;

    assert(
      !generator.validateEmbedding(nonFinite),
      "embedding generator rejects non-finite vector"
    );

    assert(
      generator.validateEmbedding(new Array(dimension).fill(0.1)),
      "embedding generator accepts valid vector"
    );

    console.log("Creating test users...");

    const userA = await createTestUser(db, password, tokens, "a");
    userIds.push(userA.userId);

    const userB = await createTestUser(db, password, tokens, "b");
    userIds.push(userB.userId);

    console.log(`User A: ${userA.email}`);
    console.log(`User B: ${userB.email}`);

    const smallSample = Buffer.from(
      [
        `Phase1 Acceptance Test ${runId}`,
        ``,
        `Apollo Caching Decision: The engineering team decided to replace the monolithic cache with a partitioned LRU cache.`,
        `Repeated Read Problem: Repeated reads from the primary database caused p99 latency spikes during peak traffic.`,
        `Retrieval Latency Fact: Retrieval latency decreased by 42 percent after the partitioned cache was deployed.`,
        `Memory Graph Entity: ContextOS is a persistent memory layer for AI agents.`,
        `Decay Preference: The team prefers visible memory decay because it makes forgetting honest and controllable.`,
        `Related concepts: Apollo Caching Decision, Repeated Read Problem, Retrieval Latency Fact, Memory Graph Entity, Decay Preference.`,
      ].join("\n"),
      "utf8"
    );

    console.log("Uploading small sample for User A...");

    const uploadA = await uploadBuffer(
      app,
      userA.token,
      smallSample,
      `phase1-small-a-${runId}.txt`
    );

    assert(uploadA.status === 202, "User A upload returns 202 immediately");
    assert(typeof uploadA.body.jobId === "string", "User A upload returns jobId");

    const jobA = await pollJob(app, userA.token, uploadA.body.jobId, SMALL_JOB_TIMEOUT_MS);

    assertJobSuccessful(jobA, "User A small sample");
    assertConceptCount(jobA, minSmall, "User A small sample");

    const docA = getJobDocumentId(jobA);
    assert(docA.length > 0, "User A document ID exists");

    const docARow = await db.queryOne<{ user_id: string }>(
      `SELECT user_id FROM documents WHERE document_id = $1`,
      [docA]
    );

    assert(docARow?.user_id === userA.userId, "User A document belongs to User A");

    const embeddingsA = await countEmbeddingsForDocument(db, docA, userA.userId);
    assert(embeddingsA > 0, "User A document has stored embeddings");

    console.log("Testing duplicate upload for same user...");

    const dupUploadA = await uploadBuffer(
      app,
      userA.token,
      smallSample,
      `phase1-small-a-dup-${runId}.txt`
    );

    assert(dupUploadA.status === 202, "Duplicate upload returns 202");

    const dupJobA = await pollJob(app, userA.token, dupUploadA.body.jobId, 120000);

    assert(dupJobA.status === "complete", "Duplicate job completes");
    assert(
      dupJobA.result?.status === "duplicate",
      "Same user same content is marked duplicate"
    );

    console.log("Uploading same content for User B...");

    const uploadB = await uploadBuffer(
      app,
      userB.token,
      smallSample,
      `phase1-small-b-${runId}.txt`
    );

    assert(uploadB.status === 202, "User B upload returns 202 immediately");

    const jobB = await pollJob(app, userB.token, uploadB.body.jobId, SMALL_JOB_TIMEOUT_MS);

    assertJobSuccessful(jobB, "User B small sample");
    assertConceptCount(jobB, minSmall, "User B small sample");

    const docB = getJobDocumentId(jobB);
    assert(docB.length > 0, "User B document ID exists");

    const docBRow = await db.queryOne<{ user_id: string }>(
      `SELECT user_id FROM documents WHERE document_id = $1`,
      [docB]
    );

    assert(docBRow?.user_id === userB.userId, "User B document belongs to User B");

    console.log("Testing API ownership isolation...");

    const bGetADocument = await request(app)
      .get(`/api/documents/${docA}`)
      .set("Authorization", `Bearer ${userB.token}`);

    assert(bGetADocument.status === 404, "User B cannot read User A document");

    const bGetAJob = await request(app)
      .get(`/api/documents/processing/${uploadA.body.jobId}`)
      .set("Authorization", `Bearer ${userB.token}`);

    assert(bGetAJob.status === 404, "User B cannot read User A processing job");

    const bDeleteADocument = await request(app)
      .delete(`/api/documents/${docA}`)
      .set("Authorization", `Bearer ${userB.token}`);

    assert(bDeleteADocument.status === 404, "User B cannot delete User A document");

    const aList = await request(app)
      .get(`/api/documents`)
      .set("Authorization", `Bearer ${userA.token}`);

    assert(aList.status === 200, "User A document list works");
    assert(
      !aList.body.documents.some((d: any) => d.documentId === docB),
      "User A list does not include User B document"
    );

    const bList = await request(app)
      .get(`/api/documents`)
      .set("Authorization", `Bearer ${userB.token}`);

    assert(bList.status === 200, "User B document list works");
    assert(
      !bList.body.documents.some((d: any) => d.documentId === docA),
      "User B list does not include User A document"
    );

    console.log("Testing bucket ownership...");

    const aBucketCountRow = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM buckets WHERE document_id = $1 AND user_id = $2`,
      [docA, userA.userId]
    );

    assert(Number(aBucketCountRow?.count ?? 0) > 0, "User A document created owned buckets");

    const bBucketCountRow = await db.queryOne<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM buckets WHERE document_id = $1 AND user_id = $2`,
      [docB, userB.userId]
    );

    assert(Number(bBucketCountRow?.count ?? 0) > 0, "User B document created owned buckets");

    console.log("Testing relationship store isolation...");

    assert(
      typeof deps.relationshipStore.syncFromConcepts === "function",
      "relationshipStore.syncFromConcepts exists"
    );

    assert(
      typeof deps.relationshipStore.expandFromBucketIds === "function",
      "relationshipStore.expandFromBucketIds exists"
    );

    const a1 = await deps.bucketStore.getOrCreateBucket(
      `Phase1 Alpha ${runId} A`,
      "Phase one alpha test memory for user A.",
      "fact",
      8,
      "phase1-test",
      docA
    );

    const a2 = await deps.bucketStore.getOrCreateBucket(
      `Phase1 Beta ${runId} A`,
      "Phase one beta test memory for user A.",
      "fact",
      7,
      "phase1-test",
      docA
    );

    const b1 = await deps.bucketStore.getOrCreateBucket(
      `Phase1 Alpha ${runId} B`,
      "Phase one alpha test memory for user B.",
      "fact",
      8,
      "phase1-test",
      docB
    );

    const b2 = await deps.bucketStore.getOrCreateBucket(
      `Phase1 Beta ${runId} B`,
      "Phase one beta test memory for user B.",
      "fact",
      7,
      "phase1-test",
      docB
    );

    assert(
      a1.bucketId !== b1.bucketId,
      "Same label can exist separately for different users"
    );

    const syncedA = await deps.relationshipStore.syncFromConcepts({
      userId: userA.userId,
      documentId: docA,
      edges: [
        {
          sourceBucketId: a1.bucketId,
          targetBucketId: a2.bucketId,
          relationType: "related_to",
          confidence: 0.9,
          sourceText: "phase1 test edge A",
        },
      ],
    });

    assert(syncedA > 0, "Relationship sync works for User A");

    const syncedB = await deps.relationshipStore.syncFromConcepts({
      userId: userB.userId,
      documentId: docB,
      edges: [
        {
          sourceBucketId: b1.bucketId,
          targetBucketId: b2.bucketId,
          relationType: "related_to",
          confidence: 0.9,
          sourceText: "phase1 test edge B",
        },
      ],
    });

    assert(syncedB > 0, "Relationship sync works for User B");

    const expandA = await deps.relationshipStore.expandFromBucketIds(
      [a1.bucketId],
      userA.userId,
      50
    );

    assert(
      expandA.some(
        (e: any) => e.targetBucketId === a2.bucketId || e.sourceBucketId === a2.bucketId
      ),
      "User A graph expansion finds User A edge"
    );

    assert(
      !expandA.some(
        (e: any) => e.targetBucketId === b2.bucketId || e.sourceBucketId === b2.bucketId
      ),
      "User A graph expansion does not leak User B edge"
    );

    console.log("Testing live embedding and retrieval...");

    const anchorBucket = await getFirstBucketForDocument(db, docA, userA.userId);

    const ai = deps.aiRouter || deps.modelRouter || deps.bedrockClient;
    const queryVector = await ai.generateEmbedding(anchorBucket.canonical);

    assert(
      Array.isArray(queryVector) && queryVector.length === dimension,
      "Live query embedding returns correct dimension"
    );

    const similarA = await (deps.embeddingStore as any).searchSimilar(
      queryVector,
      10,
      userA.userId
    );

    assert(similarA.length > 0, "User-scoped vector search returns results");

    await assertBucketsOwnedBy(
      db,
      similarA.map((s: any) => s.bucketId),
      userA.userId,
      "User-scoped vector search"
    );

    const storedVector = await deps.embeddingStore.getEmbedding(anchorBucket.bucket_id);

    assert(
      Array.isArray(storedVector) && storedVector.length === dimension,
      "Stored embedding can be retrieved and has correct dimension"
    );

    const scopedResults = await (deps.embeddingStore as any).searchSimilarWithinDocument(
      storedVector,
      docA,
      10,
      userA.userId
    );

    assert(scopedResults.length > 0, "Document-scoped vector search returns results");

    await assertBucketsInDocument(
      db,
      scopedResults.map((s: any) => s.bucketId),
      docA,
      "Document-scoped vector search"
    );

    const terms = anchorBucket.canonical
      .toLowerCase()
      .split(/\s+/)
      .filter((w: string) => w.length > 2)
      .slice(0, 5);

    const querySpec = {
      keyTerms: terms.length > 0 ? terms : [anchorBucket.canonical],
      expandedTerms: [],
      intent: "recall",
      domain: "general",
      specificity: 0.8,
      preferredTypes: [],
      isAbstractQuery: false,
    };

    const retrievedA = await (deps.retriever as any).retrieve(
      querySpec,
      undefined,
      userA.userId
    );

    assert(Array.isArray(retrievedA), "Retriever returns an array");
    assert(retrievedA.length > 0, "Retriever returns results for User A");

    await assertBucketsOwnedBy(
      db,
      retrievedA.map((r: any) => r.bucketId),
      userA.userId,
      "Retriever global results"
    );

    const retrievedScopedA = await (deps.retriever as any).retrieve(
      querySpec,
      docA,
      userA.userId
    );

    assert(
      Array.isArray(retrievedScopedA) && retrievedScopedA.length > 0,
      "Document-scoped retriever returns results"
    );

    await assertBucketsInDocument(
      db,
      retrievedScopedA.map((r: any) => r.bucketId),
      docA,
      "Document-scoped retriever results"
    );

    if (testFileArg) {
      const filePath = path.resolve(testFileArg);

      assert(fs.existsSync(filePath), `Provided test file exists: ${filePath}`);

      const pdfBuffer = fs.readFileSync(filePath);
      const pdfName = path.basename(filePath);

      console.log(`Uploading PDF: ${pdfName}`);
      console.log("PDF ingestion may take longer because it uses real AI extraction.");

      const pdfUpload = await uploadBuffer(app, userA.token, pdfBuffer, pdfName);

      assert(pdfUpload.status === 202, "PDF upload returns 202 immediately");
      assert(typeof pdfUpload.body.jobId === "string", "PDF upload returns jobId");

      const pdfJob = await pollJob(app, userA.token, pdfUpload.body.jobId, PDF_JOB_TIMEOUT_MS);

      assertJobSuccessful(pdfJob, "PDF ingestion");
      assertConceptCount(pdfJob, minPdf, "PDF ingestion");

      const pdfDocId = getJobDocumentId(pdfJob);
      assert(pdfDocId.length > 0, "PDF document ID exists");

      const pdfDocRow = await db.queryOne<{ user_id: string }>(
        `SELECT user_id FROM documents WHERE document_id = $1`,
        [pdfDocId]
      );

      assert(pdfDocRow?.user_id === userA.userId, "PDF document belongs to User A");

      const pdfEmbeddings = await countEmbeddingsForDocument(db, pdfDocId, userA.userId);
      assert(pdfEmbeddings > 0, "PDF document has stored embeddings");

      const pdfBucketCountRow = await db.queryOne<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM buckets WHERE document_id = $1 AND user_id = $2`,
        [pdfDocId, userA.userId]
      );

      assert(Number(pdfBucketCountRow?.count ?? 0) > 0, "PDF document created owned buckets");
    }

    console.log("");
    console.log("ALL PHASE 1 TESTS PASSED");
  } catch (error) {
    failed = true;
    console.error("");
    console.error("TEST FAILED");
    console.error((error as Error).message);
  } finally {
    try {
      if (!skipCleanup) {
        await cleanup(db, deps, userIds);
      } else {
        console.log("Cleanup skipped because PHASE1_SKIP_CLEANUP is enabled");
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