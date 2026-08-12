import * as fs from "fs";
import * as path from "path";
import { initPool, closePool } from "../src/database";
import { initializeDependencies } from "../src/api/dependencies";
import { detectFormat } from "../src/ingestion/format-detector";
import { parseDocument } from "../src/ingestion/parsers/index";
import { createMetadataGate } from "../src/ingestion/metadata-gate";
import { processDocumentExtraction } from "../src/ingestion/smart-processor";
import { createConceptFromRaw, conceptToText } from "../src/models/concept.model";
import type { Concept } from "../src/models/concept.model";
import type { RawConceptFromAI } from "../src/agent/bedrock-client";
import { getQueryAnalyzer } from "../src/injection/query-analyzer";
import config from "../src/config";

const FILE_PATH = process.argv[2];
const SKIP_AI = process.argv.includes("--no-ai");

if (!FILE_PATH) {
  console.log("Usage: npx ts-node tests/test-full-pipeline.ts <path-to-file> [--no-ai]");
  process.exit(1);
}

const CONCURRENT_STORES = 10;
const GLOBAL_MIN_SIMILARITY = 0.15;

async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map((item, idx) => fn(item, i + idx)));
    results.push(...batchResults);
  }
  return results;
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface TestResult {
  fastTimeMs: number;
  aiTimeMs: number;
  filterTimeMs: number;
  embedTimeMs: number;
  allConcepts: Concept[];
  aiConcepts: RawConceptFromAI[];
  totalChunks: number;
  chunksSentToAi: number;
}

async function main() {
  if (!fs.existsSync(FILE_PATH)) {
    console.log(`File not found: ${FILE_PATH}`);
    process.exit(1);
  }

  const wallStart = Date.now();
  console.log("Connecting to CockroachDB...");
  initPool();
  console.log("Initializing dependencies...\n");
  const deps = initializeDependencies();
  const queryAnalyzer = getQueryAnalyzer(deps.bedrockClient);

  const buffer = fs.readFileSync(FILE_PATH);
  const filename = path.basename(FILE_PATH);
  const fileSizeKB = (buffer.length / 1024).toFixed(1);
  console.log(`File: ${filename} (${fileSizeKB} KB)`);

  const detection = detectFormat(filename, buffer);
  const parsed = await parseDocument(detection.format, buffer, filename);
  const text = parsed.text;

  const gateStart = Date.now();
  const gateResult = createMetadataGate(text, filename, detection.format, detection.format);
  const gateTimeMs = Date.now() - gateStart;
  console.log(`Domain: ${gateResult.domain} | Type: ${gateResult.fieldType}`);
  console.log(`Words: ${gateResult.wordCount?.toLocaleString()}`);
  console.log(`Metadata gate: ${fmt(gateTimeMs)}`);
  console.log(`Mode: ${SKIP_AI ? "FAST ONLY" : "SMART (sectioned AI calls + parallel embeddings)"}\n`);
  console.log("Processing...\n");

  const result = await processDocument(gateResult, deps, SKIP_AI, filename);

  console.log("\nStoring in CockroachDB...");
  const storeStart = Date.now();
  let newBuckets = 0;
  let mergedBuckets = 0;
  let embeddingsStored = 0;
  let storeErrors = 0;
  let documentId = "";

  try {
    documentId = await deps.rawStore.storeDocument(filename, gateResult.fieldType, text);
  } catch (err) {
    console.error(`  Document store failed: ${(err as Error).message}`);
  }

  const storeResults = await parallelMap(
    result.allConcepts,
    async (concept: Concept) => {
      try {
        const { bucketId, isNew } = await deps.bucketStore.getOrCreateBucket(
          concept.label,
          concept.definition,
          concept.conceptType,
          concept.importance,
          concept.source,
          documentId
        );
        let hasEmbedding = false;
        if (concept.embedding && deps.embeddingGenerator.validateEmbedding(concept.embedding)) {
          await deps.embeddingStore.storeEmbedding(bucketId, concept.embedding, documentId);
          hasEmbedding = true;
        }
        return { success: true, isNew, hasEmbedding };
      } catch (err) {
        return { success: false, isNew: false, hasEmbedding: false, error: (err as Error).message };
      }
    },
    CONCURRENT_STORES
  );

  for (const r of storeResults) {
    if (r.success) {
      if (r.isNew) newBuckets++;
      else mergedBuckets++;
      if (r.hasEmbedding) embeddingsStored++;
    } else {
      storeErrors++;
    }
  }
  const storeTimeMs = Date.now() - storeStart;

  const withEmbeddings = result.allConcepts.filter((c) => c.embedding !== null);
  let relationshipsMapped = 0;

  console.log("\nMapping relationships...");
  try {
    const extractionResult = await deps.relationshipMapper.mapFromExtraction(
      result.aiConcepts,
      withEmbeddings
    );
    relationshipsMapped = extractionResult.stored;
    console.log(
      `  From extraction: rawRelated=${result.aiConcepts.filter(
        (r) => Array.isArray((r as any).related) && (r as any).related.length > 0
      ).length}, deduplicated=${extractionResult.relationships.length}, stored=${extractionResult.stored}`
    );
  } catch (err) {
    console.log(`  Extraction mapping failed: ${(err as Error).message}`);
  }

  if (relationshipsMapped === 0 && withEmbeddings.length > 1) {
    try {
      const discoveryResult = await deps.relationshipMapper.discoverCrossDocument(
        withEmbeddings,
        deps.embeddingStore as any
      );
      relationshipsMapped = discoveryResult.stored;
      console.log(
        `  From vector discovery: discovered=${discoveryResult.relationships.length}, stored=${discoveryResult.stored}`
      );
    } catch (err) {
      console.log(`  Vector discovery failed: ${(err as Error).message}`);
    }
  }
  console.log(`  Total relationships stored: ${relationshipsMapped}`);

  const bucketCount = await deps.bucketStore.getTotalCount();
  const embedCount = await deps.embeddingStore.getCount();
  const relCount = await deps.relationshipStore.getTotalCount();

  const ranked = [...result.allConcepts].sort((a, b) => b.importance - a.importance);
  const topLabels = ranked
    .slice(0, 4)
    .map((c) => c.label)
    .filter((l) => l.length > 0);
  const dynamicQueries = topLabels.map((l) => `what is ${l}`);
  const genericQueries = [
    "what is this document about",
    "main ideas and key concepts",
    "most important findings or points",
  ];
  const rawTestQueries = [...genericQueries.slice(0, 2), ...dynamicQueries.slice(0, 2)];

  console.log("\n=================================");
  console.log("RAW VECTOR SEARCH TEST");
  console.log("=================================");
  if (dynamicQueries.length === 0) {
    console.log("  (no concepts extracted - cannot build dynamic queries)");
  }
  for (const testQuery of rawTestQueries) {
    console.log(`\nQuery: "${testQuery}"`);
    const embedStart = Date.now();
    const qEmbed = await deps.bedrockClient.generateEmbedding(testQuery);
    const embedTimeMs = Date.now() - embedStart;
    if (qEmbed.length > 0) {
      const searchStart = Date.now();
      const allSimilar = await deps.embeddingStore.searchSimilar(qEmbed, 10);
      const similar = allSimilar.filter((m) => m.similarity >= GLOBAL_MIN_SIMILARITY);
      const searchTimeMs = Date.now() - searchStart;
      console.log(
        `  Embed query: ${fmt(embedTimeMs)} | Search DB: ${fmt(searchTimeMs)} | Total: ${fmt(
          embedTimeMs + searchTimeMs
        )}`
      );
      if (similar.length === 0) {
        console.log(`  (no results above ${GLOBAL_MIN_SIMILARITY} threshold)`);
      }
      for (const match of similar) {
        const canonical = await deps.bucketStore.getCanonical(match.bucketId);
        const def = await deps.bucketStore.getDefinition(match.bucketId);
        console.log(`  ${match.similarity.toFixed(3)} | ${canonical}`);
        if (def) console.log(`         ${def.substring(0, 120)}`);
      }
    }
  }

  const retrieverTestQueries = [...genericQueries, ...dynamicQueries.slice(0, 3)];

  console.log("\n=================================");
  console.log("FULL RETRIEVER PIPELINE TEST");
  console.log("=================================");
  for (const testQuery of retrieverTestQueries) {
    console.log(`\nQuery: "${testQuery}"`);
    const analysisStart = Date.now();
    const querySpec = await queryAnalyzer.analyze(testQuery);
    const analysisMs = Date.now() - analysisStart;
    console.log(
      `  Intent: ${querySpec.intent} | Specificity: ${querySpec.specificity.toFixed(
        2
      )} | Abstract: ${querySpec.isAbstractQuery}`
    );
    console.log(`  Key terms: [${querySpec.keyTerms.join(", ")}]`);
    console.log(`  Expanded: [${(querySpec.expandedTerms || []).join(", ")}]`);
    const retrieveStart = Date.now();
    const results = await deps.retriever.retrieve(querySpec);
    const retrieveMs = Date.now() - retrieveStart;
    console.log(
      `  Analysis: ${fmt(analysisMs)} | Retrieval: ${fmt(retrieveMs)} | Results: ${results.length}`
    );
    if (results.length === 0) {
      console.log("  (no results)");
    }
    for (const r of results.slice(0, 5)) {
      console.log(
        `  ${r.scores.relevanceScore.toFixed(4)} | ${r.canonical} [${r.conceptType}] imp=${r.importance}`
      );
      if (r.definition) console.log(`         ${r.definition.substring(0, 120)}`);
      console.log(
        `         semantic=${r.scores.semanticScore.toFixed(3)} strength=${r.scores.strengthScore.toFixed(
          3
        )} overview=${r.scores.overviewBoost.toFixed(3)} sig=${r.scores.significanceBoost.toFixed(3)}`
      );
    }
  }

  if (documentId) {
    console.log("\n=================================");
    console.log("DOCUMENT-SCOPED SEARCH TEST");
    console.log("=================================");
    const docQueries = ["main contribution", "what is this document about", ...dynamicQueries.slice(0, 1)];
    for (const testQuery of docQueries) {
      console.log(`\nQuery (scoped): "${testQuery}"`);
      const analysisStart = Date.now();
      const querySpec = await queryAnalyzer.analyze(testQuery);
      const analysisMs = Date.now() - analysisStart;
      console.log(
        `  Intent: ${querySpec.intent} | Specificity: ${querySpec.specificity.toFixed(
          2
        )} | Abstract: ${querySpec.isAbstractQuery}`
      );
      const retrieveStart = Date.now();
      const results = await deps.retriever.retrieve(querySpec, documentId);
      const retrieveMs = Date.now() - retrieveStart;
      console.log(
        `  Analysis: ${fmt(analysisMs)} | Retrieval: ${fmt(retrieveMs)} | Results: ${results.length}`
      );
      if (results.length === 0) {
        console.log("  (no results in document scope)");
      }
      for (const r of results.slice(0, 5)) {
        console.log(
          `  ${r.scores.relevanceScore.toFixed(4)} | ${r.canonical} [${r.conceptType}] imp=${r.importance}`
        );
        if (r.definition) console.log(`         ${r.definition.substring(0, 120)}`);
        console.log(
          `         semantic=${r.scores.semanticScore.toFixed(3)} strength=${r.scores.strengthScore.toFixed(
            3
          )} overview=${r.scores.overviewBoost.toFixed(3)} sig=${r.scores.significanceBoost.toFixed(3)}`
        );
      }
    }
  }

  if (relCount > 0) {
    console.log("\n=================================");
    console.log("GRAPH TRAVERSAL TEST");
    console.log("=================================");
    const sortedConcepts = [...result.allConcepts].sort((a, b) => b.importance - a.importance);
    let foundBucketId: string | null = null;
    let foundLabel = "";
    for (const concept of sortedConcepts) {
      const bucketId = await deps.bucketStore.findByCanonicalAndDocument(concept.label, documentId);
      if (bucketId) {
        foundBucketId = bucketId;
        foundLabel = concept.label;
        break;
      }
    }
    if (foundBucketId) {
      console.log(`\nStarting from: "${foundLabel}" (${foundBucketId})`);
      try {
        const graphResult = await deps.graphTraverser.traverse([foundBucketId]);
        console.log(`  Nodes found: ${graphResult.nodes.length}`);
        console.log(`  Edges found: ${graphResult.edges.length}`);
        for (const node of graphResult.nodes.slice(0, 5)) {
          console.log(
            `    -> ${node.label} (hop: ${node.hopDistance}, confidence: ${node.maxConfidence.toFixed(3)})`
          );
        }
      } catch (err) {
        console.log(`  Graph traversal failed: ${(err as Error).message}`);
      }
    } else {
      console.log("  Could not find any bucket for graph traversal");
    }
  }

  const totalWallMs = Date.now() - wallStart;
  console.log("\n=================================");
  console.log("PERFORMANCE BREAKDOWN");
  console.log("=================================");
  console.log(`Metadata gate:         ${fmt(gateTimeMs)}`);
  console.log(`AI extraction:         ${fmt(result.aiTimeMs)}`);
  console.log(`Filter + dedup:        ${fmt(result.filterTimeMs)}`);
  console.log(`Embeddings (parallel): ${fmt(result.embedTimeMs)}`);
  console.log(`DB storage (parallel): ${fmt(storeTimeMs)}`);
  console.log(`Relationships:         ${fmt(0)}`);
  console.log(`--------------------------------`);
  console.log(`TOTAL WALL TIME:       ${fmt(totalWallMs)}`);

  console.log("\n=================================");
  console.log("RESULTS");
  console.log("=================================");
  console.log(`Document:           ${filename}`);
  console.log(`Document ID:        ${documentId || "N/A"}`);
  console.log(`AI concepts:        ${result.aiConcepts.length}`);
  console.log(`After filter+merge: ${result.allConcepts.length}`);
  console.log(`With embeddings:    ${embeddingsStored}`);
  console.log(`Buckets in DB:      ${bucketCount}`);
  console.log(`Embeddings in DB:   ${embedCount}`);
  console.log(`Relationships in DB: ${relCount}`);
  console.log(`Store errors:       ${storeErrors}`);

  console.log("\n=================================");
  console.log("TOP 10 CONCEPTS");
  console.log("=================================");
  const top = [...result.allConcepts]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 10);
  for (const c of top) {
    const hasEmb = c.embedding ? "vec" : "no-vec";
    const hasSig = c.significance ? "sig" : "no-sig";
    console.log(`  [${c.importance}] (${hasEmb}/${hasSig}) ${c.label} --- ${c.conceptType}`);
    console.log(`       ${c.definition.substring(0, 120)}`);
    if (c.significance) {
      console.log(`       SIG: ${c.significance.substring(0, 120)}`);
    }
  }

  await closePool();
  console.log("\nDone.");
}

async function processDocument(
  gateResult: ReturnType<typeof createMetadataGate>,
  deps: ReturnType<typeof initializeDependencies>,
  skipAi: boolean,
  filename: string
): Promise<TestResult> {
  const text = gateResult.parsed.text;
  const domain = gateResult.domain;
  const fieldType = gateResult.fieldType;

  let aiConcepts: RawConceptFromAI[] = [];
  let aiTimeMs = 0;

  if (!skipAi) {
    console.log(`  Sending to AI (sectioned extraction, ${text.length} chars)...`);
    const aiStart = Date.now();
    const extractionResult = await processDocumentExtraction(
      text,
      domain,
      fieldType,
      deps.bedrockClient,
      filename
    );
    aiConcepts = extractionResult.concepts;
    aiTimeMs = Date.now() - aiStart;
    const withSignificance = aiConcepts.filter(
      (c) => typeof c.significance === "string" && c.significance.length > 0
    ).length;
    console.log(
      `  AI returned ${aiConcepts.length} concepts (${withSignificance} with significance) in ${fmt(
        aiTimeMs
      )}`
    );
    const overviewRaw = aiConcepts.find((c) =>
      /overview|summary/i.test(String(c.label || ""))
    );
    if (overviewRaw) {
      console.log(`  Overview bucket label: "${String(overviewRaw.label)}"`);
    }
    const previewLabels = aiConcepts
      .map((c) => String(c.label || ""))
      .filter((l) => l.length > 0 && !/overview|summary/i.test(l))
      .slice(0, 6);
    if (previewLabels.length > 0) {
      console.log(`  Sample concept labels: ${previewLabels.join(" | ")}`);
    }
  }

  const filterStart = Date.now();
  const seen = new Map<string, RawConceptFromAI>();
  for (const raw of aiConcepts) {
    if (typeof raw.label !== "string" || typeof raw.definition !== "string") continue;
    const key = raw.label.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, raw);
    } else {
      const existingImportance =
        typeof existing.importance === "number" ? existing.importance : 5;
      const currentImportance = typeof raw.importance === "number" ? raw.importance : 5;
      if (currentImportance > existingImportance) {
        seen.set(key, raw);
      }
    }
  }
  const dedupedRaw = Array.from(seen.values());
  const filterTimeMs = Date.now() - filterStart;
  console.log(`  After dedup: ${dedupedRaw.length} concepts`);

  const embedStart = Date.now();
  const allConcepts: Concept[] = [];
  const conceptsToEmbed = dedupedRaw
    .map((raw) => createConceptFromRaw(raw, filename))
    .filter((c): c is Concept => c !== null && c.importance >= config.extraction.minConceptImportance);
  console.log(
    `  Embedding ${conceptsToEmbed.length} concepts (parallel, concurrency=${config.embedding.concurrency})...`
  );
  const embedResults = await parallelMap(
    conceptsToEmbed,
    async (concept: Concept) => {
      try {
        let embedText = conceptToText(concept);
        const labelLower = concept.label.toLowerCase();
        const isOverview =
          labelLower.includes("overview") ||
          labelLower.includes("summary") ||
          labelLower.includes("abstract");
        if (isOverview) {
          embedText = `Summary of the document: This document is about ${concept.label}. ${concept.definition}`;
          if (concept.significance) {
            embedText += ` ${concept.significance}`;
          }
        }
        const embedding = await deps.embeddingGenerator.generate(embedText);
        return { ...concept, embedding };
      } catch {
        return { ...concept, embedding: null };
      }
    },
    config.embedding.concurrency
  );
  allConcepts.push(...embedResults);
  const embedTimeMs = Date.now() - embedStart;
  const withEmbeddings = allConcepts.filter((c) => c.embedding !== null).length;
  console.log(`  Embedded: ${withEmbeddings}/${allConcepts.length} in ${fmt(embedTimeMs)}`);

  return {
    fastTimeMs: 0,
    aiTimeMs,
    filterTimeMs,
    embedTimeMs,
    allConcepts,
    aiConcepts,
    totalChunks: 1,
    chunksSentToAi: skipAi ? 0 : 1,
  };
}

main().catch(async (err) => {
  console.error("\nFATAL:", err.message);
  console.error(err.stack);
  await closePool().catch(() => {});
  process.exit(1);
});