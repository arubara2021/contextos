import { task } from "@trigger.dev/sdk/v3";
import { initPool, closePool, query, queryOne } from "../database";
import { initializeDependencies, getDependencies } from "../api/dependencies";
import { parseDocument } from "../ingestion/parsers";
import { createHash } from "crypto";
import type { FileFormat } from "../types/ingestion.types";
import logger from "../utils/logger";

// ─── Helpers (same logic as documents.routes.ts) ───────────────────────────
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}
function clampUnit(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}
function nonNegInt(v: unknown): number {
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}
function emptyConn() {
  return { exactMerges: 0, semanticConnections: 0, crossDocumentConnections: 0, strongConnections: 0, connectionScore: 0 };
}
function normConn(v: unknown) {
  if (!v || typeof v !== "object") return emptyConn();
  const o = v as any;
  return {
    exactMerges: nonNegInt(o.exactMerges),
    semanticConnections: nonNegInt(o.semanticConnections),
    crossDocumentConnections: nonNegInt(o.crossDocumentConnections),
    strongConnections: nonNegInt(o.strongConnections),
    connectionScore: clampUnit(o.connectionScore),
  };
}
function normRelated(v: unknown): any[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is any => Boolean(r && typeof r === "object")).map((r) => ({
    documentId: String(r.documentId ?? r.document_id ?? ""),
    filename: String(r.filename ?? "Unknown"),
    correlation: clampUnit(r.correlation ?? r.correlationScore ?? 0),
    sharedConcepts: nonNegInt(r.sharedConcepts ?? r.shared_bucket_count ?? 0),
    edges: nonNegInt(r.edges ?? r.edge_count ?? 0),
    avgConfidence: clampUnit(r.avgConfidence ?? r.avg_confidence ?? 0),
  })).filter((r) => isValidUuid(r.documentId));
}
function normTop(v: unknown): any[] {
  if (!Array.isArray(v)) return [];
  return v.filter((r): r is any => Boolean(r && typeof r === "object")).map((r) => {
    const rawId = r.documentId === null || r.document_id === null ? null : String(r.documentId ?? r.document_id ?? "");
    return {
      bucketId: String(r.bucketId ?? r.bucket_id ?? ""),
      label: String(r.label ?? r.canonical ?? ""),
      relationType: String(r.relationType ?? r.relation_type ?? "related_to"),
      confidence: clampUnit(r.confidence ?? 0),
      documentId: rawId && isValidUuid(rawId) ? rawId : null,
    };
  }).filter((r) => isValidUuid(r.bucketId) && r.label.length > 0);
}
function normExtraction(v: unknown): any | null {
  if (!v || typeof v !== "object") return null;
  const o = v as any;
  return {
    warnings: Array.isArray(o.warnings) ? o.warnings.filter((x: unknown): x is string => typeof x === "string") : [],
    sectionCount: nonNegInt(o.sectionCount),
    aiCalls: nonNegInt(o.aiCalls),
    rawConceptCount: nonNegInt(o.rawConceptCount),
    acceptedConceptCount: nonNegInt(o.acceptedConceptCount),
    existingMemoriesProvided: nonNegInt(o.existingMemoriesProvided),
  };
}

async function updateJob(jobId: string, patch: any): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const col = k.replace(/([A-Z])/g, "_$1").toLowerCase();
    fields.push(`${col} = $${idx++}`);
    values.push(v);
  }
  if (fields.length === 0) return;
  values.push(jobId);
  await query(`UPDATE processing_jobs SET ${fields.join(", ")} WHERE job_id = $${idx}::uuid`, values);
}

// ─── The Task ──────────────────────────────────────────────────────────────
export const processDocumentTask = task({
  id: "process-document",
  run: async (payload: { jobId: string; userId: string }) => {
    const { jobId, userId } = payload;
    logger.info("Trigger.dev worker started", { jobId, userId });

    // Init DB + deps (worker runs in its own process)
    initPool();
    initializeDependencies();

    try {
      // Load the uploaded file from DB
      const fileRow = await queryOne<{
        filename: string;
        file_type: string;
        format: string;
        mime_type: string;
        size_bytes: string | number;
        content_base64: string;
      }>(
        `SELECT filename, file_type, format, mime_type, size_bytes, content_base64
         FROM uploaded_files WHERE file_id = (
           SELECT file_id FROM processing_jobs WHERE job_id = $1::uuid
         ) AND user_id = $2::uuid`,
        [jobId, userId]
      );

      // Fallback: try s3_key locator style
      const jobRow = await queryOne<{
        filename: string; file_type: string; format: string;
        mime_type: string | null; size_bytes: string | number; s3_key: string | null;
      }>(
        `SELECT filename, file_type, format, mime_type, size_bytes, s3_key
         FROM processing_jobs WHERE job_id = $1::uuid AND user_id = $2::uuid`,
        [jobId, userId]
      );

      if (!jobRow) {
        throw new Error("Processing job not found");
      }

      let fileBuffer: Buffer;
      let filename = jobRow.filename;
      let fileType = jobRow.file_type;
      let format = jobRow.format as FileFormat;
      let mimeType = jobRow.mime_type ?? "application/octet-stream";
      let sizeBytes = Number(jobRow.size_bytes);

      // Load buffer from uploaded_files table
      const locator = jobRow.s3_key ?? "";
      if (locator.startsWith("dbupload:")) {
        const fileId = locator.slice("dbupload:".length);
        const uploadRow = await queryOne<{ content_base64: string }>(
          `SELECT content_base64 FROM uploaded_files WHERE file_id = $1::uuid AND user_id = $2::uuid`,
          [fileId, userId]
        );
        if (!uploadRow) throw new Error("Uploaded file not found in DB");
        fileBuffer = Buffer.from(uploadRow.content_base64, "base64");
      } else if (fileRow?.content_base64) {
        fileBuffer = Buffer.from(fileRow.content_base64, "base64");
      } else {
        throw new Error("No uploaded file buffer found for job");
      }

      // ─── Parse ──────────────────────────────────────────────────
      await updateJob(jobId, { status: "processing", stage: "parsing", progress: 10, message: "Parsing file..." });
      const parsed = await parseDocument(format, fileBuffer, filename);
      const content = (parsed?.text || "").trim();
      if (content.length < 10) {
        throw new Error("No extractable text found. This may be a scanned document.");
      }

      // ─── Dedupe ─────────────────────────────────────────────────
      const contentHash = createHash("sha256").update(content, "utf8").digest("hex");
      const existing = await queryOne<{ document_id: string }>(
        `SELECT document_id FROM documents WHERE user_id = $1::uuid AND content_hash = $2 LIMIT 1`,
        [userId, contentHash]
      );
      if (existing) {
        await updateJob(jobId, {
          fileId: existing.document_id, status: "complete", stage: "complete",
          progress: 100, message: "Duplicate document skipped", completedAt: new Date(),
          result: {
            fileId: existing.document_id, filename, fieldType: "other", domain: "general", status: "duplicate",
            chunksCreated: 0, conceptsExtracted: 0, embeddingsGenerated: 0, newBuckets: 0, mergedBuckets: 0,
            durationMs: 0, errors: [], connections: emptyConn(), relatedDocuments: [], topConnectedMemories: [], extraction: null
          },
        });
        await cleanup(jobId);
        return { status: "duplicate" };
      }

      // ─── Create document row ────────────────────────────────────
      const doc = await queryOne<{ document_id: string }>(
        `INSERT INTO documents (filename, file_type, content, content_hash, s3_key, user_id)
         VALUES ($1, $2, $3, $4, NULL, $5::uuid) RETURNING document_id`,
        [filename, fileType, content, contentHash, userId]
      );
      if (!doc) throw new Error("Failed to create document record");

      await updateJob(jobId, {
        fileId: doc.document_id, status: "processing", stage: "extracting",
        progress: 40, message: "Extracting concepts and generating embeddings...",
      });

      // ─── Run full pipeline ──────────────────────────────────────
      const { ingestionPipeline } = getDependencies();
      const ingestionResult: any = await ingestionPipeline.ingestDocument(
        content, filename, fileType, doc.document_id, userId
      );

      const connections = normConn(ingestionResult.connections);
      const relatedDocuments = normRelated(ingestionResult.relatedDocuments);
      const topConnectedMemories = normTop(ingestionResult.topConnectedMemories);
      const extraction = normExtraction(ingestionResult.extraction);

      if (ingestionResult.status === "failed" || ingestionResult.status === "empty") {
        const errors = Array.isArray(ingestionResult.errors) ? ingestionResult.errors.filter((x: unknown): x is string => typeof x === "string") : [];
        if (errors.length === 0) errors.push("No concepts extracted");
        await updateJob(jobId, {
          fileId: doc.document_id, status: "failed", stage: "failed", progress: 100,
          message: "Extraction failed", error: errors[0], completedAt: new Date(),
          result: {
            fileId: doc.document_id, filename, fieldType: "other", domain: "general", status: "failed",
            chunksCreated: 1, conceptsExtracted: 0, embeddingsGenerated: 0, newBuckets: 0, mergedBuckets: 0,
            durationMs: ingestionResult.durationMs ?? 0, errors, connections, relatedDocuments, topConnectedMemories, extraction
          },
        });
        await cleanup(jobId);
        return { status: "failed" };
      }

      // ─── Success ────────────────────────────────────────────────
      await updateJob(jobId, {
        fileId: doc.document_id, status: "complete", stage: "complete", progress: 100,
        message: `${ingestionResult.conceptsExtracted} concepts extracted, ${ingestionResult.newBuckets} new memories`,
        completedAt: new Date(),
        result: {
          fileId: doc.document_id, filename, fieldType: "other", domain: "general", status: "complete",
          chunksCreated: ingestionResult.chunksProcessed ?? 1,
          conceptsExtracted: ingestionResult.conceptsExtracted ?? 0,
          embeddingsGenerated: ingestionResult.conceptsExtracted ?? 0,
          newBuckets: ingestionResult.newBuckets ?? 0,
          mergedBuckets: ingestionResult.mergedBuckets ?? 0,
          durationMs: ingestionResult.durationMs ?? 0, errors: [],
          connections, relatedDocuments, topConnectedMemories, extraction,
        },
      });

      await cleanup(jobId);
      logger.info("Trigger.dev worker complete", { jobId, concepts: ingestionResult.conceptsExtracted });
      return { status: "complete", concepts: ingestionResult.conceptsExtracted };
    } catch (error) {
      const message = (error as Error).message;
      logger.error("Trigger.dev worker failed", { jobId, error: message });
      await updateJob(jobId, {
        status: "failed", stage: "failed", progress: 100,
        message: `Failed: ${message}`, error: message, completedAt: new Date(),
      }).catch(() => { });
      throw error;
    } finally {
      await closePool().catch(() => { });
    }
  },
});

async function cleanup(jobId: string) {
  try {
    const row = await queryOne<{ s3_key: string | null }>(
      `SELECT s3_key FROM processing_jobs WHERE job_id = $1::uuid`, [jobId]
    );
    if (row?.s3_key?.startsWith("dbupload:")) {
      const fileId = row.s3_key.slice("dbupload:".length);
      await query(`DELETE FROM uploaded_files WHERE file_id = $1::uuid`, [fileId]).catch(() => { });
    }
  } catch { }
}