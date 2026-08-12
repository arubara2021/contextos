import "dotenv/config";
import * as fs from "fs";
import * as path from "path";

if (process.env.BEDROCK_REGION && process.env.PHASE1_FORCE_BEDROCK_REGION !== "false") {
  process.env.AWS_REGION = process.env.BEDROCK_REGION;
}

const filePath = process.argv[2] || "";

const question =
  process.argv[3] ||
  "What is the main contribution of this document, what problem does it solve, and what results does it report?";

const keepData = ["true", "1", "yes"].includes(
  (process.env.OUTPUT_TEST_KEEP || "").toLowerCase()
);

function line(title: string): void {
  console.log("");
  console.log("=".repeat(70));
  console.log(title);
  console.log("=".repeat(70));
}

function toFormat(ext: string): string {
  switch (ext) {
    case ".pdf":
      return "pdf";
    case ".docx":
    case ".doc":
      return "docx";
    case ".md":
    case ".markdown":
      return "md";
    case ".txt":
      return "txt";
    case ".json":
      return "json";
    case ".csv":
      return "csv";
    case ".html":
      return "html";
    case ".yaml":
    case ".yml":
      return "yaml";
    default:
      return "txt";
  }
}

async function safeQuery(db: any, text: string, params?: unknown[]): Promise<void> {
  try {
    await db.query(text, params);
  } catch (error) {
    console.log(`Cleanup warning: ${(error as Error).message}`);
  }
}

async function main(): Promise<void> {
  let failed = false;
  let userId = "";
  let documentId = "";

  if (!filePath) {
    console.log("Usage:");
    console.log(
      'npx ts-node --transpile-only tests/show-real-pdf-output.ts "C:\\Users\\arun0\\Videos\\contextos\\test.pdf" "What is the main contribution?"'
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`File not found: ${resolvedPath}`);
    process.exit(1);
  }

  const db = await import("../src/database");
  const dependencies = await import("../src/api/dependencies");
  const password = await import("../src/auth/password");
  const parsers = await import("../src/ingestion/parsers");

  db.initPool();

  const deps: any = dependencies.initializeDependencies();

  try {
    line("CONTEXTOS REAL PDF OUTPUT TEST");

    console.log(`File: ${resolvedPath}`);
    console.log(`Question: ${question}`);
    console.log(`Keep data: ${keepData ? "yes" : "no"}`);

    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const email = `pdf_output_${runId}@contextos.test`;
    const passwordHash = await password.hashPassword(`PdfOutputTest123!${runId}`);

    const userRow = await db.queryOne<{ user_id: string }>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING user_id`,
      [email, passwordHash, `PDF Output Test ${runId}`]
    );

    if (!userRow?.user_id) {
      throw new Error("Failed to create temporary test user");
    }

    userId = userRow.user_id;

    console.log(`Temporary user: ${email}`);

    const filename = path.basename(resolvedPath);
    const ext = path.extname(resolvedPath).toLowerCase();
    const format = toFormat(ext);
    const fileBuffer = fs.readFileSync(resolvedPath);

    line("PARSING FILE");

    let content = "";

    try {
      const parsed: any = await (parsers as any).parseDocument(
        format,
        fileBuffer,
        filename
      );

      content = (parsed?.text || "").trim();

      if (Array.isArray(parsed?.parseErrors) && parsed.parseErrors.length > 0) {
        console.log("Parser warnings/errors:");
        console.log(parsed.parseErrors);
      }
    } catch (error) {
      console.log("Structured parser failed, falling back to raw text.");
      console.log((error as Error).message);
      content = fileBuffer.toString("utf8").trim();
    }

    if (!content || content.trim().length < 10) {
      throw new Error("No extractable text found in file.");
    }

    console.log(`Extracted text length: ${content.length} characters`);
    console.log(`Text preview: ${content.substring(0, 300)}...`);

    documentId = await deps.rawStore.storeDocument(filename, ext || ".pdf", content);

    await db.query(
      `UPDATE documents SET user_id = $1 WHERE document_id = $2`,
      [userId, documentId]
    );

    console.log(`Document ID: ${documentId}`);

    line("INGESTING DOCUMENT");

    console.log("This may take a while for a real PDF because it uses real AI extraction.");

    const ingestion: any = await deps.ingestionPipeline.ingestDocument(
      content,
      filename,
      ext || ".pdf",
      documentId,
      userId
    );

    console.log("");
    console.log("Ingestion result:");
    console.log(JSON.stringify(ingestion, null, 2));

    line("EXTRACTED MEMORIES");

    const buckets = await db.query(
      `SELECT bucket_id, canonical, concept_type, importance, strength
       FROM buckets
       WHERE document_id = $1 AND user_id = $2
       ORDER BY importance DESC, strength DESC, canonical ASC
       LIMIT 40`,
      [documentId, userId]
    );

    if (buckets.rows.length === 0) {
      console.log("No memories were extracted.");
    }

    for (let i = 0; i < buckets.rows.length; i++) {
      const bucket = buckets.rows[i];

      const definitionRow = await db.queryOne<{ definition: string | null }>(
        `SELECT definition
         FROM bucket_items
         WHERE bucket_id = $1 AND definition IS NOT NULL
         ORDER BY timestamp DESC
         LIMIT 1`,
        [bucket.bucket_id]
      );

      console.log("");
      console.log(`Memory ${i + 1}`);
      console.log(`Label:      ${bucket.canonical}`);
      console.log(`Type:       ${bucket.concept_type}`);
      console.log(`Importance: ${bucket.importance}`);
      console.log(`Strength:   ${Number(bucket.strength).toFixed(3)}`);
      console.log(`Definition: ${definitionRow?.definition || "No definition stored"}`);
    }

    line("RELATIONSHIPS");

    const relationships = await db.query(
      `SELECT
         r.relation_type,
         r.confidence,
         COALESCE(b1.canonical, r.source_bucket) AS source_label,
         COALESCE(b2.canonical, r.target_bucket) AS target_label
       FROM relationships r
       LEFT JOIN buckets b1 ON b1.canonical = r.source_bucket
       LEFT JOIN buckets b2 ON b2.canonical = r.target_bucket
       WHERE r.user_id = $1
          OR r.source_bucket_id IN (
            SELECT bucket_id FROM buckets WHERE document_id = $2 AND user_id = $1
          )
          OR r.target_bucket_id IN (
            SELECT bucket_id FROM buckets WHERE document_id = $2 AND user_id = $1
          )
       ORDER BY r.confidence DESC
       LIMIT 40`,
      [userId, documentId]
    );

    if (relationships.rows.length === 0) {
      console.log("No relationships were created.");
    }

    for (const rel of relationships.rows) {
      console.log("");
      console.log(
        `${rel.source_label} --[${rel.relation_type}]--> ${rel.target_label}`
      );
      console.log(`Confidence: ${Number(rel.confidence).toFixed(3)}`);
    }

    line("CORRELATION OUTPUT");

    console.log("Connections:");
    console.log(JSON.stringify(ingestion.connections ?? null, null, 2));

    console.log("");
    console.log("Related documents from ingestion:");
    console.log(JSON.stringify(ingestion.relatedDocuments ?? [], null, 2));

    console.log("");
    console.log("Top connected memories from ingestion:");
    console.log(JSON.stringify(ingestion.topConnectedMemories ?? [], null, 2));

    try {
      const storedRelatedDocuments = await db.query(
        `SELECT
           dl.target_document_id,
           d.filename,
           dl.correlation_score,
           dl.shared_bucket_count,
           dl.edge_count,
           dl.avg_confidence
         FROM document_links dl
         JOIN documents d ON d.document_id = dl.target_document_id
         WHERE dl.source_document_id = $1 AND dl.user_id = $2
         ORDER BY dl.correlation_score DESC
         LIMIT 10`,
        [documentId, userId]
      );

      console.log("");
      console.log("Stored document_links rows:");
      console.log(JSON.stringify(storedRelatedDocuments.rows, null, 2));
    } catch (error) {
      console.log("Could not query document_links:");
      console.log((error as Error).message);
    }

    line("QUERY ANALYSIS");

    const querySpec = await deps.queryAnalyzer.analyzeWithAI(question);

    console.log("");
    console.log(`Intent:        ${querySpec.intent}`);
    console.log(`Specificity:   ${querySpec.specificity}`);
    console.log(`Abstract:      ${querySpec.isAbstractQuery}`);
    console.log(`Key terms:     ${querySpec.keyTerms.join(", ")}`);
    console.log(`Expanded:      ${(querySpec.expandedTerms || []).join(", ")}`);
    console.log(`Preferred:     ${(querySpec.preferredTypes || []).join(", ")}`);

    line("RETRIEVAL RESULTS");

    const scored = await (deps.retriever as any).retrieve(
      querySpec,
      documentId,
      userId
    );

    if (!Array.isArray(scored) || scored.length === 0) {
      console.log("No memories retrieved.");
    }

    for (let i = 0; i < scored.length; i++) {
      const item = scored[i];

      console.log("");
      console.log(`Retrieved ${i + 1}`);
      console.log(`Label:      ${item.canonical}`);
      console.log(`Type:       ${item.conceptType}`);
      console.log(`Importance: ${item.importance}`);
      console.log(`Strength:   ${Number(item.strength).toFixed(3)}`);
      console.log(
        `Relevance:  ${Number(item.scores?.relevanceScore ?? 0).toFixed(4)}`
      );
      console.log(
        `Semantic:   ${Number(item.scores?.semanticScore ?? 0).toFixed(4)}`
      );
      console.log(
        `Vector:     ${Number(item.scores?.vectorScore ?? 0).toFixed(4)}`
      );
      console.log(`Text:       ${Number(item.scores?.textScore ?? 0).toFixed(4)}`);
      console.log(`Graph:      ${Number(item.scores?.graphScore ?? 0).toFixed(4)}`);
      console.log(
        `Connectivity: ${Number(item.scores?.connectivityScore ?? 0).toFixed(4)}`
      );
      console.log(`Definition: ${item.definition || "No definition stored"}`);
    }

    line("MEMORY-INJECTED ANSWER");

    const assembly = deps.assembler.assemble(scored, querySpec);

    console.log("");
    console.log(`Total candidates:   ${assembly?.contextBlock?.totalCandidates ?? 0}`);
    console.log(`Budget used:        ${assembly?.contextBlock?.budgetUsed ?? 0}`);
    console.log(`Selected memories:  ${assembly?.selectedMemories?.length ?? 0}`);

    const selected = assembly?.selectedMemories || [];

    if (selected.length > 0) {
      console.log("");
      console.log("Memory trace:");

      for (const memory of selected) {
        console.log(
          `- ${memory.label || memory.canonical || memory.bucketId} [${
            memory.conceptType || "memory"
          }]`
        );
      }
    }

    const prompt = deps.promptBuilder.buildSystemContextPrompt(
      assembly.contextBlock,
      question
    );

    const modelResult = await deps.modelRouter.send(
      prompt.systemPrompt,
      prompt.userPrompt
    );

    console.log("");
    console.log("Final answer:");
    console.log("");
    console.log(modelResult.response);

    line("REAL PDF OUTPUT TEST COMPLETE");
  } catch (error) {
    failed = true;
    console.error("");
    console.error("REAL PDF OUTPUT TEST FAILED");
    console.error((error as Error).message);
  } finally {
    if (!keepData && userId) {
      line("CLEANUP");

      await safeQuery(
        db,
        `DELETE FROM document_links
         WHERE user_id = $1
            OR source_document_id = $2
            OR target_document_id = $2`,
        [userId, documentId]
      );

      await safeQuery(
        db,
        `DELETE FROM relationships
         WHERE user_id = $1
            OR source_bucket_id IN (
              SELECT bucket_id FROM buckets WHERE user_id = $1
            )
            OR target_bucket_id IN (
              SELECT bucket_id FROM buckets WHERE user_id = $1
            )`,
        [userId]
      );

      await safeQuery(
        db,
        `DELETE FROM embeddings
         WHERE bucket_id IN (
           SELECT bucket_id FROM buckets WHERE user_id = $1
         )`,
        [userId]
      );

      await safeQuery(
        db,
        `DELETE FROM bucket_items
         WHERE bucket_id IN (
           SELECT bucket_id FROM buckets WHERE user_id = $1
         )`,
        [userId]
      );

      await safeQuery(
        db,
        `DELETE FROM raw_chunks WHERE document_id = $1`,
        [documentId]
      );

      await safeQuery(
        db,
        `DELETE FROM buckets WHERE user_id = $1`,
        [userId]
      );

      await safeQuery(
        db,
        `DELETE FROM documents WHERE user_id = $1`,
        [userId]
      );

      await safeQuery(
        db,
        `DELETE FROM users WHERE user_id = $1`,
        [userId]
      );

      console.log("Temporary test data removed.");
    } else if (keepData) {
      console.log("");
      console.log("Data kept for inspection.");
      console.log(`User ID:     ${userId}`);
      console.log(`Document ID: ${documentId}`);
    }

    await db.closePool();
  }

  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal test error");
  console.error(error);
  process.exit(1);
});