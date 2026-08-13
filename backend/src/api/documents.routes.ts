import { Router, Response } from "express";
import {
  randomUUID,
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "crypto";
import multer from "multer";
import { authMiddleware, AuthenticatedRequest } from "../auth/middleware";
import { getDependencies } from "./dependencies";
import { parseDocument } from "../ingestion/parsers";
import { query, queryOne, queryMany } from "../database";
import type { FileFormat } from "../types/ingestion.types";
import logger from "../utils/logger";
import { waitUntil } from "@vercel/functions";

const SANDBOX_MAX_UPLOADS = 3;

const FORMAT_MAP: Record<string, FileFormat> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".doc": "docx",
  ".md": "md",
  ".json": "json",
  ".csv": "csv",
  ".txt": "txt",
  ".html": "html",
  ".py": "code",
  ".ts": "code",
  ".js": "code",
  ".yaml": "yaml",
  ".yml": "yaml",
};

const FILE_ENCRYPTION_SECRET =
  process.env.FILE_ENCRYPTION_KEY ||
  process.env.JWT_SECRET ||
  "contextos-insecure-file-secret";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) return "";
  return filename.substring(lastDot).toLowerCase();
}

function toFileFormat(ext: string): FileFormat {
  return FORMAT_MAP[ext] || "unknown";
}

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

function encryptBuffer(input: Buffer): Buffer {
  const salt = randomBytes(16);
  const key = deriveKey(FILE_ENCRYPTION_SECRET, salt);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(input), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.from(
    [
      salt.toString("base64"),
      iv.toString("base64"),
      tag.toString("base64"),
      ciphertext.toString("base64"),
    ].join(".")
  );
}

function decryptBuffer(input: Buffer): Buffer {
  const raw = input.toString("utf8");
  const parts = raw.split(".");

  if (parts.length !== 4) {
    return input;
  }

  try {
    const salt = Buffer.from(parts[0], "base64");
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const ciphertext = Buffer.from(parts[3], "base64");
    const key = deriveKey(FILE_ENCRYPTION_SECRET, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return input;
  }
}

function decryptText(value: string): string {
  if (!value.startsWith("enc:v1:")) {
    return value;
  }

  try {
    return decryptBuffer(Buffer.from(value.slice(7), "base64")).toString("utf8");
  } catch {
    return value;
  }
}

function clampUnit(value: unknown): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function nonNegativeInt(value: unknown): number {
  const num = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
}

function emptyConnectionStats() {
  return {
    exactMerges: 0,
    semanticConnections: 0,
    crossDocumentConnections: 0,
    strongConnections: 0,
    connectionScore: 0,
  };
}

function normalizeConnections(value: unknown) {
  if (!value || typeof value !== "object") {
    return emptyConnectionStats();
  }

  const obj = value as Record<string, unknown>;

  return {
    exactMerges: nonNegativeInt(obj.exactMerges),
    semanticConnections: nonNegativeInt(obj.semanticConnections),
    crossDocumentConnections: nonNegativeInt(obj.crossDocumentConnections),
    strongConnections: nonNegativeInt(obj.strongConnections),
    connectionScore: clampUnit(obj.connectionScore),
  };
}

function normalizeRelatedDocuments(value: unknown): any[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is Record<string, any> =>
        Boolean(item && typeof item === "object")
    )
    .map((row) => ({
      documentId: String(row.documentId ?? row.document_id ?? ""),
      filename: String(row.filename ?? "Unknown document"),
      correlation: clampUnit(row.correlation ?? row.correlationScore ?? 0),
      sharedConcepts: nonNegativeInt(
        row.sharedConcepts ?? row.shared_bucket_count ?? 0
      ),
      edges: nonNegativeInt(row.edges ?? row.edge_count ?? 0),
      avgConfidence:
        row.avgConfidence === undefined && row.avg_confidence === undefined
          ? undefined
          : clampUnit(row.avgConfidence ?? row.avg_confidence),
    }))
    .filter((row) => isValidUuid(row.documentId));
}

function normalizeTopConnectedMemories(value: unknown): any[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item): item is Record<string, any> =>
        Boolean(item && typeof item === "object")
    )
    .map((row) => {
      const rawDocumentId =
        row.documentId === null || row.document_id === null
          ? null
          : String(row.documentId ?? row.document_id ?? "");

      return {
        bucketId: String(row.bucketId ?? row.bucket_id ?? ""),
        label: String(row.label ?? row.canonical ?? ""),
        relationType: String(row.relationType ?? row.relation_type ?? "related_to"),
        confidence: clampUnit(row.confidence ?? 0),
        documentId:
          rawDocumentId && isValidUuid(rawDocumentId) ? rawDocumentId : null,
      };
    })
    .filter((row) => isValidUuid(row.bucketId) && row.label.length > 0);
}

function normalizeExtraction(value: unknown): any | null {
  if (!value || typeof value !== "object") return null;

  const obj = value as Record<string, unknown>;

  return {
    warnings: Array.isArray(obj.warnings)
      ? obj.warnings.filter((item): item is string => typeof item === "string")
      : [],
    sectionCount: nonNegativeInt(obj.sectionCount),
    aiCalls: nonNegativeInt(obj.aiCalls),
    rawConceptCount: nonNegativeInt(obj.rawConceptCount),
    acceptedConceptCount: nonNegativeInt(obj.acceptedConceptCount),
    existingMemoriesProvided: nonNegativeInt(obj.existingMemoriesProvided),
  };
}

async function getRelatedDocumentsForDocument(
  userId: string,
  documentId: string,
  limit: number
): Promise<any[]> {
  if (!isValidUuid(userId) || !isValidUuid(documentId)) {
    return [];
  }

  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit || 10)));

  try {
    const { relationshipStore } = getDependencies();
    const store = relationshipStore as any;

    if (typeof store.getRelatedDocuments === "function") {
      const rows = await store.getRelatedDocuments(userId, documentId, safeLimit);
      return normalizeRelatedDocuments(rows);
    }
  } catch (error) {
    logger.debug("getRelatedDocuments via relationshipStore failed", {
      userId,
      documentId,
      error: (error as Error).message,
    });
  }

  try {
    const rows = await queryMany<any>(
      `WITH links AS (
         SELECT CASE
                  WHEN source_document_id = $2::uuid THEN target_document_id
                  ELSE source_document_id
                END AS other_document_id,
                correlation_score,
                shared_bucket_count,
                edge_count,
                avg_confidence
         FROM document_links
         WHERE user_id = $1::uuid
           AND (source_document_id = $2::uuid OR target_document_id = $2::uuid)
       )
       SELECT links.other_document_id::text AS document_id,
              d.filename,
              MAX(links.correlation_score)::float AS correlation,
              MAX(links.shared_bucket_count)::int AS shared_concepts,
              MAX(links.edge_count)::int AS edges,
              MAX(links.avg_confidence)::float AS avg_confidence
       FROM links
       JOIN documents d ON d.document_id = links.other_document_id
       WHERE d.user_id = $1::uuid
         AND links.other_document_id <> $2::uuid
       GROUP BY links.other_document_id, d.filename
       ORDER BY correlation DESC, edges DESC
       LIMIT $3`,
      [userId, documentId, safeLimit]
    );

    return normalizeRelatedDocuments(rows);
  } catch (error) {
    logger.debug("getRelatedDocuments fallback failed", {
      userId,
      documentId,
      error: (error as Error).message,
    });

    return [];
  }
}

interface JobPatch {
  fileId?: string | null;
  status?: string;
  stage?: string;
  progress?: number;
  message?: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
  completedAt?: Date | null;
  s3Key?: string | null;
}

async function updateJob(jobId: string, patch: JobPatch): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (patch.fileId !== undefined) {
    fields.push(`file_id = $${idx++}`);
    values.push(patch.fileId);
  }

  if (patch.status !== undefined) {
    fields.push(`status = $${idx++}`);
    values.push(patch.status);
  }

  if (patch.stage !== undefined) {
    fields.push(`stage = $${idx++}`);
    values.push(patch.stage);
  }

  if (patch.progress !== undefined) {
    fields.push(`progress = $${idx++}`);
    values.push(patch.progress);
  }

  if (patch.message !== undefined) {
    fields.push(`message = $${idx++}`);
    values.push(patch.message);
  }

  if (patch.result !== undefined) {
    fields.push(`result = $${idx++}`);
    values.push(patch.result);
  }

  if (patch.error !== undefined) {
    fields.push(`error = $${idx++}`);
    values.push(patch.error);
  }

  if (patch.completedAt !== undefined) {
    fields.push(`completed_at = $${idx++}`);
    values.push(patch.completedAt);
  }

  if (patch.s3Key !== undefined) {
    fields.push(`s3_key = $${idx++}`);
    values.push(patch.s3Key);
  }

  if (fields.length === 0) return;

  values.push(jobId);

  await query(
    `UPDATE processing_jobs
     SET ${fields.join(", ")}
     WHERE job_id = $${idx}::uuid`,
    values
  );
}

async function processDocumentAsync(
  jobId: string,
  userId: string,
  filename: string,
  fileType: string,
  format: FileFormat,
  mimeType: string,
  sizeBytes: number,
  fileBuffer: Buffer
): Promise<void> {
  try {
    if (!isValidUuid(userId)) {
      throw new Error("Invalid user id");
    }

    await updateJob(jobId, {
      status: "processing",
      stage: "parsing",
      progress: 10,
      message: "Parsing file...",
    });

    const parsed = await parseDocument(format, fileBuffer, filename);
    const content = (parsed?.text || "").trim();

    if (content.length < 10) {
      const detail = (parsed?.parseErrors || []).join("; ");

      throw new Error(
        detail
          ? `No extractable text (${detail})`
          : "No extractable text found. This may be a scanned document."
      );
    }

    const contentHash = createHash("sha256").update(content, "utf8").digest("hex");

    const existing = await queryOne<{ document_id: string }>(
      `SELECT document_id
       FROM documents
       WHERE user_id = $1::uuid AND content_hash = $2
       LIMIT 1`,
      [userId, contentHash]
    );

    if (existing) {
      await updateJob(jobId, {
        fileId: existing.document_id,
        status: "complete",
        stage: "complete",
        progress: 100,
        message: "Duplicate document skipped",
        completedAt: new Date(),
        result: {
          fileId: existing.document_id,
          filename,
          fieldType: "other",
          domain: "general",
          status: "duplicate",
          chunksCreated: 0,
          conceptsExtracted: 0,
          embeddingsGenerated: 0,
          newBuckets: 0,
          mergedBuckets: 0,
          durationMs: 0,
          errors: [],
          connections: emptyConnectionStats(),
          relatedDocuments: [],
          topConnectedMemories: [],
          extraction: null,
        },
      });

      return;
    }

    const { ingestionPipeline, s3Client } = getDependencies();

    let s3Key: string | null = null;
    const s3Available = await s3Client.isAvailable().catch(() => false);

    if (s3Available) {
      try {
        const encryptedFile = encryptBuffer(fileBuffer);
        s3Key = `uploads/${userId}/${Date.now()}_${filename}`;
        await s3Client.upload(s3Key, encryptedFile, "application/octet-stream");
      } catch (s3Error) {
        logger.warn("S3 upload of encrypted file failed, continuing without S3", {
          filename,
          error: (s3Error as Error).message,
        });

        s3Key = null;
      }
    }

    let doc: { document_id: string } | null = null;
    try {
      doc = await queryOne<{ document_id: string }>(
        `INSERT INTO documents (filename, file_type, content, content_hash, s3_key, user_id)
     VALUES ($1, $2, $3, $4, $5, $6::uuid)
     RETURNING document_id`,
        [filename, fileType, content, contentHash, s3Key, userId]
      );
    } catch (insertErr: any) {
      // Catch the race condition duplicate key error gracefully
      if (insertErr.message.includes("duplicate key") && insertErr.message.includes("idx_documents_user_content_hash")) {
        doc = await queryOne<{ document_id: string }>(
          `SELECT document_id FROM documents WHERE user_id = $1::uuid AND content_hash = $2 LIMIT 1`,
          [userId, contentHash]
        );
        if (doc) {
          await updateJob(jobId, {
            fileId: doc.document_id,
            status: "complete",
            stage: "complete",
            progress: 100,
            message: "Duplicate document skipped",
            completedAt: new Date(),
            result: {
              fileId: doc.document_id, filename, fieldType: "other", domain: "general",
              status: "duplicate", chunksCreated: 0, conceptsExtracted: 0,
              embeddingsGenerated: 0, newBuckets: 0, mergedBuckets: 0,
              durationMs: 0, errors: [], connections: emptyConnectionStats(),
              relatedDocuments: [], topConnectedMemories: [], extraction: null,
            },
          });
          res.status(202).json({ jobId, filename: file.originalname, fileType, format, sizeBytes: file.size, status: "processing" });
          return;
        }
      }
      throw insertErr;
    }
    if (!doc) {
      throw new Error("Failed to create document record");
    }

    await updateJob(jobId, {
      fileId: doc.document_id,
      s3Key,
      status: "processing",
      stage: "extracting",
      progress: 40,
      message: "Extracting concepts and generating embeddings...",
    });

    const ingestionResult: any = await ingestionPipeline.ingestDocument(
      content,
      filename,
      fileType,
      doc.document_id,
      userId
    );

    const connections = normalizeConnections(ingestionResult.connections);
    const relatedDocuments = normalizeRelatedDocuments(ingestionResult.relatedDocuments);
    const topConnectedMemories = normalizeTopConnectedMemories(
      ingestionResult.topConnectedMemories
    );
    const extraction = normalizeExtraction(ingestionResult.extraction);

    if (ingestionResult.status === "duplicate") {
      await updateJob(jobId, {
        fileId: ingestionResult.documentId || doc.document_id,
        status: "complete",
        stage: "complete",
        progress: 100,
        message: "Duplicate document skipped",
        completedAt: new Date(),
        result: {
          fileId: ingestionResult.documentId || doc.document_id,
          filename,
          fieldType: "other",
          domain: "general",
          status: "duplicate",
          chunksCreated: 0,
          conceptsExtracted: 0,
          embeddingsGenerated: 0,
          newBuckets: 0,
          mergedBuckets: 0,
          durationMs: ingestionResult.durationMs ?? 0,
          errors: [],
          connections,
          relatedDocuments,
          topConnectedMemories,
          extraction,
        },
      });

      return;
    }

    if (ingestionResult.status === "failed" || ingestionResult.status === "empty") {
      const errors = Array.isArray(ingestionResult.errors)
        ? ingestionResult.errors.filter(
          (item: unknown): item is string => typeof item === "string"
        )
        : [];

      if (errors.length === 0) {
        errors.push("No concepts extracted");
      }

      await updateJob(jobId, {
        fileId: doc.document_id,
        status: "failed",
        stage: "failed",
        progress: 100,
        message: "Extraction failed",
        error: errors[0],
        completedAt: new Date(),
        result: {
          fileId: doc.document_id,
          filename,
          fieldType: "other",
          domain: "general",
          status: "failed",
          chunksCreated: 1,
          conceptsExtracted: 0,
          embeddingsGenerated: 0,
          newBuckets: 0,
          mergedBuckets: 0,
          durationMs: ingestionResult.durationMs ?? 0,
          errors,
          connections,
          relatedDocuments,
          topConnectedMemories,
          extraction,
        },
      });

      return;
    }

    const errors = Array.isArray(ingestionResult.errors)
      ? ingestionResult.errors.filter(
        (item: unknown): item is string => typeof item === "string"
      )
      : [];

    if (Number(ingestionResult.chunksFailed ?? 0) > 0) {
      errors.push(`${Number(ingestionResult.chunksFailed)} chunks failed extraction`);
    }

    await updateJob(jobId, {
      fileId: doc.document_id,
      status: "complete",
      stage: "complete",
      progress: 100,
      message: `${ingestionResult.conceptsExtracted} concepts extracted, ${ingestionResult.newBuckets} new memories`,
      completedAt: new Date(),
      result: {
        fileId: doc.document_id,
        filename,
        fieldType: "other",
        domain: "general",
        status: "complete",
        chunksCreated: ingestionResult.chunksProcessed ?? 1,
        conceptsExtracted: ingestionResult.conceptsExtracted ?? 0,
        embeddingsGenerated: ingestionResult.conceptsExtracted ?? 0,
        newBuckets: ingestionResult.newBuckets ?? 0,
        mergedBuckets: ingestionResult.mergedBuckets ?? 0,
        durationMs: ingestionResult.durationMs ?? 0,
        errors,
        connections,
        relatedDocuments,
        topConnectedMemories,
        extraction,
      },
    });
  } catch (error) {
    const message = (error as Error).message;

    logger.error("Document processing failed", {
      jobId,
      filename,
      error: message,
    });

    await updateJob(jobId, {
      status: "failed",
      stage: "failed",
      progress: 100,
      message: `Failed: ${message}`,
      error: message,
      completedAt: new Date(),
    }).catch(() => { });
  }
}
const QSTASH_URL = process.env.QSTASH_URL ?? "";
const QSTASH_TOKEN = process.env.QSTASH_TOKEN ?? "";
const INTERNAL_PROCESS_SECRET = process.env.INTERNAL_PROCESS_SECRET ?? "";
const PUBLIC_BACKEND_URL =
  process.env.PUBLIC_BACKEND_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

function queueConfigured(): boolean {
  return Boolean(
    QSTASH_URL &&
    QSTASH_TOKEN &&
    INTERNAL_PROCESS_SECRET &&
    PUBLIC_BACKEND_URL
  );
}

let uploadFilesTableReady: Promise<void> | null = null;

function ensureUploadFilesTable(): Promise<void> {
  if (!uploadFilesTableReady) {
    uploadFilesTableReady = query(
      `CREATE TABLE IF NOT EXISTS uploaded_files (
        file_id UUID PRIMARY KEY,
        user_id UUID NOT NULL,
        filename TEXT NOT NULL,
        file_type TEXT NOT NULL,
        format TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL,
        content_base64 TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`
    ).then(() => undefined);
  }
  return uploadFilesTableReady;
}

async function storeUploadedFile(params: {
  userId: string;
  filename: string;
  fileType: string;
  format: FileFormat;
  mimeType: string;
  sizeBytes: number;
  fileBuffer: Buffer;
}): Promise<string> {
  await ensureUploadFilesTable();

  const fileId = randomUUID();

  await query(
    `INSERT INTO uploaded_files (
      file_id,
      user_id,
      filename,
      file_type,
      format,
      mime_type,
      size_bytes,
      content_base64
    ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8)`,
    [
      fileId,
      params.userId,
      params.filename,
      params.fileType,
      params.format,
      params.mimeType,
      params.sizeBytes,
      params.fileBuffer.toString("base64"),
    ]
  );

  return `dbupload:${fileId}`;
}

async function enqueueDocumentProcessing(
  jobId: string,
  userId: string
): Promise<void> {
  const destination =
    `${PUBLIC_BACKEND_URL}/api/documents/process` +
    `?secret=${encodeURIComponent(INTERNAL_PROCESS_SECRET)}` +
    `&jobId=${encodeURIComponent(jobId)}` +
    `&userId=${encodeURIComponent(userId)}`;

  const publishUrl =
    `${QSTASH_URL.replace(/\/+$/, "")}/v2/publish/` +
    encodeURIComponent(destination);

  const response = await fetch(publishUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${QSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`QStash enqueue failed: ${response.status} ${errorText}`);
  }
}

async function runUntil(promise: Promise<unknown>): Promise<void> {
  try {
    const vercelFunctions = await import("@vercel/functions");

    if (typeof vercelFunctions.waitUntil === "function") {
      vercelFunctions.waitUntil(promise);
      return;
    }
  } catch { }

  await promise;
}

async function loadUploadedFileBuffer(
  locator: string,
  userId: string
): Promise<{ buffer: Buffer; fileId: string } | null> {
  if (!locator.startsWith("dbupload:")) {
    return null;
  }

  const fileId = locator.slice("dbupload:".length);

  const row = await queryOne<{ content_base64: string }>(
    `SELECT content_base64
     FROM uploaded_files
     WHERE file_id = $1::uuid AND user_id = $2::uuid`,
    [fileId, userId]
  );

  if (!row) {
    return null;
  }

  return {
    buffer: Buffer.from(row.content_base64, "base64"),
    fileId,
  };
}

async function deleteUploadedFileLocator(locator: string): Promise<void> {
  if (!locator.startsWith("dbupload:")) {
    return;
  }

  const fileId = locator.slice("dbupload:".length);

  await query(`DELETE FROM uploaded_files WHERE file_id = $1::uuid`, [
    fileId,
  ]).catch(() => { });
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/json",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "text/html",
      "text/x-python",
      "text/x-typescript",
      "text/javascript",
      "application/x-yaml",
      "text/yaml",
    ];

    const allowedExtensions = [
      ".txt",
      ".md",
      ".csv",
      ".json",
      ".pdf",
      ".docx",
      ".doc",
      ".html",
      ".py",
      ".ts",
      ".js",
      ".yaml",
      ".yml",
      ".env",
      ".sh",
    ];

    const ext = getFileExtension(file.originalname);

    if (allowedMimes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
      return;
    }

    cb(new Error(`Unsupported file type: ${file.mimetype} (${ext})`));
  },
});

const router = Router();

router.post(
  "/upload",
  authMiddleware,
  upload.single("file"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const file = req.file;

      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      if (!file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      if (file.size === 0) {
        res.status(400).json({ error: "File is empty" });
        return;
      }

      const { userStore } = getDependencies();
      const owner = await userStore.getUserById(req.userId);

      if (owner?.isSandbox) {
        const allowed = await userStore.tryConsumeSandboxUpload(
          owner.userId,
          SANDBOX_MAX_UPLOADS
        );

        if (!allowed) {
          res.status(429).json({
            error: `Sandbox upload limit reached (${SANDBOX_MAX_UPLOADS} files max)`,
          });
          return;
        }
      }

      const fileType = getFileExtension(file.originalname);
      const format = toFileFormat(fileType);
      const jobId = randomUUID();
      const mimeType = file.mimetype;

      const fileLocator = await storeUploadedFile({
        userId: req.userId,
        filename: file.originalname,
        fileType,
        format,
        mimeType,
        sizeBytes: file.size,
        fileBuffer: file.buffer,
      });

      await query(
        `INSERT INTO processing_jobs (
    job_id,
    user_id,
    filename,
    file_type,
    format,
    mime_type,
    size_bytes,
    status,
    stage,
    progress,
    message,
    started_at
  ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, 'queued', 'uploaded', 0, 'File uploaded, processing queued', now())`,
        [jobId, req.userId, file.originalname, fileType, format, mimeType, file.size]
      );

      await updateJob(jobId, {
        s3Key: fileLocator,
      });


      router.post(
        "/upload",
        authMiddleware,
        upload.single("file"),
        async (req: AuthenticatedRequest, res: Response) => {
          try {
            const file = req.file;
            if (!req.userId || !isValidUuid(req.userId)) {
              res.status(401).json({ error: "Authentication required" });
              return;
            }
            if (!file) {
              res.status(400).json({ error: "No file provided" });
              return;
            }
            if (file.size === 0) {
              res.status(400).json({ error: "File is empty" });
              return;
            }
            const { userStore } = getDependencies();
            const owner = await userStore.getUserById(req.userId);
            if (owner?.isSandbox) {
              const allowed = await userStore.tryConsumeSandboxUpload(
                owner.userId,
                SANDBOX_MAX_UPLOADS
              );
              if (!allowed) {
                res.status(429).json({
                  error: `Sandbox upload limit reached (${SANDBOX_MAX_UPLOADS} files max)`,
                });
                return;
              }
            }
            const fileType = getFileExtension(file.originalname);
            const format = toFileFormat(fileType);
            const jobId = randomUUID();
            const mimeType = file.mimetype;
            const fileLocator = await storeUploadedFile({
              userId: req.userId,
              filename: file.originalname,
              fileType,
              format,
              mimeType,
              sizeBytes: file.size,
              fileBuffer: file.buffer,
            });
            await query(
              `INSERT INTO processing_jobs (
          job_id, user_id, filename, file_type, format, mime_type, size_bytes,
          status, stage, progress, message, started_at
        ) VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, 'queued', 'uploaded', 0, 'File uploaded, processing queued', now())`,
              [jobId, req.userId, file.originalname, fileType, format, mimeType, file.size]
            );
            await updateJob(jobId, { s3Key: fileLocator });

            // --- TRIGGER.DEV BACKGROUND PROCESSING ---
            try {
              const { processDocumentTask } = await import("../tasks/document-processing.task");
              await processDocumentTask.trigger({ jobId, userId: req.userId });
              logger.info("Triggered Trigger.dev task", { jobId });
            } catch (triggerError) {
              logger.error("Trigger.dev enqueue failed, falling back to local processing", {
                jobId,
                error: (triggerError as Error).message,
              });
              const work = processDocumentAsync(
                jobId, req.userId, file.originalname, fileType, format,
                mimeType, file.size, file.buffer
              ).catch((err) => {
                logger.error("Background processing unhandled error", { jobId, error: (err as Error).message });
              });
              try {
                const { waitUntil } = await import("@vercel/functions");
                waitUntil(work);
              } catch { void work; }
            }

            res.status(202).json({
              jobId,
              filename: file.originalname,
              fileType,
              format,
              sizeBytes: file.size,
              status: "processing",
            });
          } catch (error) {
            const err = error as Error;
            if (err.message.includes("Unsupported file type")) {
              res.status(415).json({ error: err.message });
              return;
            }
            if (err.message.includes("File too large")) {
              res.status(413).json({ error: "File exceeds maximum size of 4MB (Vercel limit)" });
              return;
            }
            logger.error("POST /documents/upload failed", {
              filename: req.file?.originalname,
              error: err.message,
            });
            res.status(500).json({ error: "Failed to process document" });
          }
        }
      );
    } catch (error) {
      const err = error as Error;

      if (err.message.includes("Unsupported file type")) {
        res.status(415).json({ error: err.message });
        return;
      }

      if (err.message.includes("File too large")) {
        res.status(413).json({ error: "File exceeds maximum size of 4MB (Vercel limit)" });
        return;
      }

      logger.error("POST /documents/upload failed", {
        filename: req.file?.originalname,
        error: err.message,
      });

      res.status(500).json({ error: "Failed to process document" });
    }
  }
);

router.get(
  "/processing/:jobId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { jobId } = req.params;

      if (!jobId || !isValidUuid(jobId)) {
        res.status(404).json({ error: "Processing job not found" });
        return;
      }

      const row = await queryOne<{
        job_id: string;
        file_id: string | null;
        filename: string;
        format: string;
        status: string;
        stage: string;
        progress: number;
        message: string | null;
        result: any;
        error: string | null;
        started_at: Date;
        completed_at: Date | null;
      }>(
        `SELECT job_id, file_id, filename, format, status, stage, progress, message, result, error, started_at, completed_at
         FROM processing_jobs
         WHERE job_id = $1::uuid AND user_id = $2::uuid`,
        [jobId, req.userId]
      );

      if (!row) {
        res.status(404).json({ error: "Processing job not found" });
        return;
      }

      res.status(200).json({
        jobId: row.job_id,
        fileId: row.file_id,
        filename: row.filename,
        format: row.format,
        status: row.status,
        stage: row.stage,
        progress: row.progress,
        message: row.message,
        result: row.result,
        error: row.error,
        startedAt: row.started_at.toISOString(),
        completedAt: row.completed_at ? row.completed_at.toISOString() : null,
      });
    } catch (error) {
      logger.error("GET /documents/processing/:jobId failed", {
        jobId: req.params.jobId,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to retrieve processing job" });
    }
  }
);

router.get(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const docs = await query<{
        document_id: string;
        filename: string;
        file_type: string;
        uploaded_at: Date;
      }>(
        `SELECT document_id, filename, file_type, uploaded_at
         FROM documents
         WHERE user_id = $1::uuid
         ORDER BY uploaded_at DESC`,
        [req.userId]
      );

      const storage = await queryOne<{ total_size: string; object_count: number }>(
        `SELECT COALESCE(SUM(octet_length(content)), 0)::bigint AS total_size,
                COUNT(*)::int AS object_count
         FROM documents
         WHERE user_id = $1::uuid`,
        [req.userId]
      );

      const totalSizeBytes = Number(storage?.total_size ?? 0);

      res.status(200).json({
        documents: docs.rows.map((doc) => ({
          documentId: doc.document_id,
          filename: doc.filename,
          fileType: doc.file_type,
          uploadedAt: doc.uploaded_at.toISOString(),
        })),
        count: docs.rows.length,
        storage: {
          totalSizeBytes,
          totalSizeMB: Math.round((totalSizeBytes / (1024 * 1024)) * 100) / 100,
          objectCount: Number(storage?.object_count ?? 0),
        },
      });
    } catch (error) {
      logger.error("GET /documents failed", {
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to retrieve documents" });
    }
  }
);

router.get(
  "/:documentId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { documentId } = req.params;

      if (!documentId || !isValidUuid(documentId)) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const document = await queryOne<{
        document_id: string;
        filename: string;
        file_type: string;
        uploaded_at: Date;
        content: string | null;
        s3_key: string | null;
      }>(
        `SELECT document_id, filename, file_type, uploaded_at, content, s3_key
         FROM documents
         WHERE document_id = $1::uuid AND user_id = $2::uuid`,
        [documentId, req.userId]
      );

      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const chunks = await query<{
        chunk_id: string;
        text: string;
        metadata: any;
      }>(
        `SELECT chunk_id, text, metadata
         FROM raw_chunks
         WHERE document_id = $1::uuid
         ORDER BY chunk_id
         LIMIT 200`,
        [documentId]
      );

      const relatedDocuments = await getRelatedDocumentsForDocument(
        req.userId,
        documentId,
        10
      );

      const decryptedContent = decryptText(document.content ?? "");

      const storageInfo = document.s3_key
        ? {
          storedIn: "s3",
          s3Key: document.s3_key,
          contentPreview: decryptedContent.substring(0, 200),
        }
        : {
          storedIn: "database",
          s3Key: null,
          contentPreview: decryptedContent.substring(0, 200),
        };

      res.status(200).json({
        document: {
          documentId: document.document_id,
          filename: document.filename,
          fileType: document.file_type,
          uploadedAt: document.uploaded_at.toISOString(),
          storage: storageInfo,
        },
        chunks: chunks.rows.map((chunk) => ({
          chunkId: chunk.chunk_id,
          textPreview: chunk.text.substring(0, 200),
          metadata: chunk.metadata,
        })),
        chunkCount: chunks.rows.length,
        relatedDocuments,
        relatedDocumentCount: relatedDocuments.length,
      });
    } catch (error) {
      logger.error("GET /documents/:documentId failed", {
        documentId: req.params.documentId,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to retrieve document" });
    }
  }
);

router.get(
  "/:documentId/content",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { documentId } = req.params;

      if (!documentId || !isValidUuid(documentId)) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const document = await queryOne<{
        document_id: string;
        filename: string;
        content: string | null;
        s3_key: string | null;
      }>(
        `SELECT document_id, filename, content, s3_key
         FROM documents
         WHERE document_id = $1::uuid AND user_id = $2::uuid`,
        [documentId, req.userId]
      );

      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const content = decryptText(document.content ?? "");

      res.status(200).json({
        documentId: document.document_id,
        filename: document.filename,
        content,
        contentLength: content.length,
        storedIn: document.s3_key ? "s3" : "database",
        s3Key: document.s3_key,
      });
    } catch (error) {
      logger.error("GET /documents/:documentId/content failed", {
        documentId: req.params.documentId,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to retrieve document content" });
    }
  }
);

router.get(
  "/:documentId/memories",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { documentId } = req.params;

      if (!documentId || !isValidUuid(documentId)) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const document = await queryOne<{ document_id: string }>(
        `SELECT document_id
         FROM documents
         WHERE document_id = $1::uuid AND user_id = $2::uuid`,
        [documentId, req.userId]
      );

      if (!document) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const { bucketStore } = getDependencies();

      const memories = await bucketStore.getMemoriesByDocumentId(
        documentId,
        req.userId
      );

      res.status(200).json({
        documentId,
        memories,
        count: memories.length,
      });
    } catch (error) {
      logger.error("GET /documents/:documentId/memories failed", {
        documentId: req.params.documentId,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to retrieve document memories" });
    }
  }
);

router.delete(
  "/:documentId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { documentId } = req.params;

      if (!documentId || !isValidUuid(documentId)) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      const deleted = await queryOne<{ s3_key: string | null }>(
        `DELETE FROM documents
         WHERE document_id = $1::uuid AND user_id = $2::uuid
         RETURNING s3_key`,
        [documentId, req.userId]
      );

      if (!deleted) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      if (deleted.s3_key) {
        const { s3Client } = getDependencies();
        const client = s3Client as any;

        try {
          if (typeof client.delete === "function") {
            await client.delete(deleted.s3_key);
          } else if (typeof client.deleteObject === "function") {
            await client.deleteObject(deleted.s3_key);
          }
        } catch (s3Error) {
          logger.warn("S3 delete failed", {
            documentId,
            error: (s3Error as Error).message,
          });
        }
      }

      res.status(200).json({
        message: "Document deleted",
        documentId,
        s3Deleted: Boolean(deleted.s3_key),
      });
    } catch (error) {
      logger.error("DELETE /documents/:documentId failed", {
        documentId: req.params.documentId,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to delete document" });
    }
  }
);
router.post(
  "/process",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const secret = String(req.query.secret ?? "");
      const jobId = String(req.query.jobId ?? "");
      const userId = String(req.query.userId ?? "");

      if (!INTERNAL_PROCESS_SECRET || secret !== INTERNAL_PROCESS_SECRET) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      if (!isValidUuid(jobId) || !isValidUuid(userId)) {
        res.status(400).json({ error: "Invalid jobId or userId" });
        return;
      }

      const job = await queryOne<{
        job_id: string;
        filename: string;
        file_type: string;
        format: string;
        mime_type: string | null;
        size_bytes: number | string;
        status: string;
        s3_key: string | null;
      }>(
        `SELECT job_id, filename, file_type, format, mime_type, size_bytes, status, s3_key
         FROM processing_jobs
         WHERE job_id = $1::uuid AND user_id = $2::uuid`,
        [jobId, userId]
      );

      if (!job) {
        res.status(404).json({ error: "Processing job not found" });
        return;
      }

      if (job.status !== "queued") {
        res.status(200).json({
          ok: true,
          skipped: true,
          reason: job.status,
        });
        return;
      }

      const locked = await queryOne<{ job_id: string }>(
        `UPDATE processing_jobs
         SET status = 'processing',
             stage = 'worker',
             progress = 5,
             message = 'Worker picked up job'
         WHERE job_id = $1::uuid
           AND user_id = $2::uuid
           AND status = 'queued'
         RETURNING job_id`,
        [jobId, userId]
      );

      if (!locked) {
        res.status(200).json({
          ok: true,
          skipped: true,
          reason: "already_locked",
        });
        return;
      }

      const locator = job.s3_key ?? "";

      if (!locator.startsWith("dbupload:")) {
        await updateJob(jobId, {
          status: "failed",
          stage: "failed",
          progress: 100,
          message: "Missing uploaded file locator",
          error: "Missing uploaded file locator",
          completedAt: new Date(),
        });

        res.status(200).json({
          ok: false,
          error: "missing_locator",
        });
        return;
      }

      const loadedFile = await loadUploadedFileBuffer(locator, userId);

      if (!loadedFile) {
        await updateJob(jobId, {
          status: "failed",
          stage: "failed",
          progress: 100,
          message: "Uploaded file not found",
          error: "Uploaded file not found",
          completedAt: new Date(),
        });

        res.status(200).json({
          ok: false,
          error: "missing_file",
        });
        return;
      }

      const work = processDocumentAsync(
        jobId,
        userId,
        job.filename,
        job.file_type,
        job.format as FileFormat,
        job.mime_type ?? "application/octet-stream",
        Number(job.size_bytes),
        loadedFile.buffer
      )
        .catch((error) => {
          logger.error("Queue worker processing failed", {
            jobId,
            error: (error as Error).message,
          });
        })
        .finally(async () => {
          await deleteUploadedFileLocator(locator);
        });

      await runUntil(work);

      res.status(202).json({
        ok: true,
        jobId,
      });
    } catch (error) {
      logger.error("POST /documents/process failed", {
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Queue worker failed" });
    }
  }
);
export default router;