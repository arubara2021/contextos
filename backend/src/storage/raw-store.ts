import { query, queryOne, queryMany } from "../database";
import { S3StorageClient } from "./s3-client";
import logger from "../utils/logger";

const S3_KEY_PREFIX = "documents/";
const S3_CONTENT_THRESHOLD = Infinity;

interface DocumentRow {
  document_id: string;
  filename: string;
  file_type: string;
  content: string | null;
  s3_key: string | null;
  uploaded_at: Date;
}

interface ChunkRow {
  chunk_id: string;
  message_id: string;
  text: string;
  metadata: Record<string, unknown>;
}

interface MessageRow {
  message_id: string;
  session_id: string;
  role: string;
  content: string;
  timestamp: Date;
}

interface AllChunkRow {
  chunk_id: string;
  message_id: string;
  text: string;
  metadata: Record<string, unknown>;
}

export class RawStore {
  private readonly s3Client: S3StorageClient;
  private readonly s3ContentThreshold: number;

  constructor(s3Client?: S3StorageClient) {
    this.s3Client = s3Client ?? new S3StorageClient();
    this.s3ContentThreshold = S3_CONTENT_THRESHOLD;
  }

  async storeDocument(
    filename: string,
    fileType: string,
    content: string
  ): Promise<string> {
    const shouldUseS3 =
      Buffer.byteLength(content, "utf-8") > this.s3ContentThreshold;
    if (shouldUseS3) {
      return this.storeDocumentInS3(filename, fileType, content);
    }
    return this.storeDocumentInline(filename, fileType, content);
  }

  async getDocumentById(documentId: string): Promise<{
    documentId: string;
    filename: string;
    fileType: string;
    content: string;
    s3Key: string | null;
    uploadedAt: Date;
  } | null> {
    try {
      const row = await queryOne<DocumentRow>(
        `SELECT document_id, filename, file_type, content, s3_key, uploaded_at
         FROM documents
         WHERE document_id = $1`,
        [documentId]
      );
      if (!row) return null;
      let content: string;
      if (row.s3_key && (!row.content || row.content.trim().length === 0)) {
        content = await this.getContentFromS3(row.s3_key);
      } else if (row.content) {
        content = row.content;
      } else {
        content = "";
      }
      return {
        documentId: row.document_id,
        filename: row.filename,
        fileType: row.file_type,
        content,
        s3Key: row.s3_key,
        uploadedAt: new Date(row.uploaded_at),
      };
    } catch (error) {
      logger.error("getDocumentById failed", {
        documentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getContentFromS3(s3Key: string): Promise<string> {
    try {
      const buffer = await this.s3Client.download(s3Key);
      return buffer.toString("utf-8");
    } catch (error) {
      logger.error("getContentFromS3 failed", {
        s3Key,
        error: (error as Error).message,
      });
      throw new Error(`Failed to fetch document content from S3: ${s3Key}`);
    }
  }
  async getAllDocuments(userId?: string | null): Promise<
    Array<{
      documentId: string;
      filename: string;
      fileType: string;
      uploadedAt: Date;
    }>
  > {
    try {
      const safeUserId =
        typeof userId === "string" && /^[0-9a-f-]{36}$/i.test(userId)
          ? userId
          : null;
      const rows = safeUserId
        ? await queryMany<DocumentRow>(
          `SELECT document_id, filename, file_type, uploaded_at
FROM documents
WHERE user_id = $1::uuid
ORDER BY uploaded_at DESC`,
          [safeUserId]
        )
        : await queryMany<DocumentRow>(
          `SELECT document_id, filename, file_type, uploaded_at
FROM documents
ORDER BY uploaded_at DESC`
        );
      return rows.map((row) => ({
        documentId: row.document_id,
        filename: row.filename,
        fileType: row.file_type,
        uploadedAt: new Date(row.uploaded_at),
      }));
    } catch (error) {
      logger.error("getAllDocuments failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }


  async getStorageUsageFromDb(): Promise<{
    totalSizeBytes: number;
    objectCount: number;
  }> {
    try {
      const row = await queryOne<{ bytes: string | number; count: string | number }>(
        `SELECT COALESCE(SUM(OCTET_LENGTH(content)), 0) AS bytes,
                COUNT(*) AS count
         FROM documents`
      );
      const bytes = row?.bytes != null ? Number(row.bytes) : 0;
      const count = row?.count != null ? Number(row.count) : 0;
      return {
        totalSizeBytes: Number.isFinite(bytes) ? bytes : 0,
        objectCount: Number.isFinite(count) ? count : 0,
      };
    } catch (error) {
      logger.error("getStorageUsageFromDb failed", {
        error: (error as Error).message,
      });
      return { totalSizeBytes: 0, objectCount: 0 };
    }
  }

  async deleteDocument(documentId: string): Promise<void> {
    try {
      const row = await queryOne<{ s3_key: string | null }>(
        "SELECT s3_key FROM documents WHERE document_id = $1",
        [documentId]
      );
      if (row?.s3_key) {
        try {
          await this.s3Client.delete(row.s3_key);
        } catch (s3Error) {
          logger.warn("Failed to delete S3 object", {
            s3Key: row.s3_key,
            error: (s3Error as Error).message,
          });
        }
      }
      await query("DELETE FROM documents WHERE document_id = $1", [documentId]);
    } catch (error) {
      logger.error("deleteDocument failed", {
        documentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getChunksByDocumentId(documentId: string): Promise<
    Array<{
      chunkId: string;
      text: string;
      metadata: Record<string, unknown>;
    }>
  > {
    try {
      const rows = await queryMany<ChunkRow>(
        `SELECT chunk_id, message_id, text, metadata
         FROM raw_chunks
         WHERE message_id = $1
         ORDER BY chunk_id`,
        [documentId]
      );
      return rows.map((row) => ({
        chunkId: row.chunk_id,
        text: row.text,
        metadata: row.metadata ?? {},
      }));
    } catch (error) {
      logger.error("getChunksByDocumentId failed", {
        documentId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async storeMessage(
    sessionId: string,
    role: string,
    content: string,
    timestamp: string
  ): Promise<string> {
    try {
      const row = await queryOne<{ message_id: string }>(
        `INSERT INTO messages (session_id, role, content, timestamp)
         VALUES ($1, $2, $3, $4)
         RETURNING message_id`,
        [sessionId, role, content, timestamp]
      );
      return row?.message_id ?? "";
    } catch (error) {
      logger.error("storeMessage failed", {
        sessionId,
        role,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async storeChunk(
    messageId: string,
    text: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO raw_chunks (message_id, text, metadata)
         VALUES ($1, $2, $3)`,
        [messageId, text, JSON.stringify(metadata)]
      );
    } catch (error) {
      logger.error("storeChunk failed", {
        messageId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getMessageHistory(sessionId: string): Promise<
    Array<{
      messageId: string;
      role: string;
      content: string;
      timestamp: string;
    }>
  > {
    try {
      const rows = await queryMany<MessageRow>(
        `SELECT message_id, session_id, role, content, timestamp
         FROM messages
         WHERE session_id = $1
         ORDER BY timestamp ASC`,
        [sessionId]
      );
      return rows.map((row) => ({
        messageId: row.message_id,
        role: row.role,
        content: row.content,
        timestamp: new Date(row.timestamp).toISOString(),
      }));
    } catch (error) {
      logger.error("getMessageHistory failed", {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getChunksByMessageId(messageId: string): Promise<
    Array<{
      chunkId: string;
      text: string;
      metadata: Record<string, unknown>;
    }>
  > {
    try {
      const rows = await queryMany<ChunkRow>(
        `SELECT chunk_id, message_id, text, metadata
         FROM raw_chunks
         WHERE message_id = $1
         ORDER BY chunk_id`,
        [messageId]
      );
      return rows.map((row) => ({
        chunkId: row.chunk_id,
        text: row.text,
        metadata: row.metadata ?? {},
      }));
    } catch (error) {
      logger.error("getChunksByMessageId failed", {
        messageId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getAllChunks(): Promise<
    Array<{
      chunkId: string;
      messageId: string;
      text: string;
      metadata: Record<string, unknown>;
    }>
  > {
    try {
      const rows = await queryMany<AllChunkRow>(
        `SELECT chunk_id, message_id, text, metadata
         FROM raw_chunks
         ORDER BY chunk_id`
      );
      return rows.map((row) => ({
        chunkId: row.chunk_id,
        messageId: row.message_id,
        text: row.text,
        metadata: row.metadata ?? {},
      }));
    } catch (error) {
      logger.error("getAllChunks failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }
  async getTotalMessages(userId?: string | null): Promise<number> {
    try {
      const safeUserId =
        typeof userId === "string" && /^[0-9a-f-]{36}$/i.test(userId)
          ? userId
          : null;
      const row = safeUserId
        ? await queryOne<{ count: number }>(
          `SELECT COUNT(*)::int AS count
FROM messages m
JOIN sessions s ON s.session_id = m.session_id
WHERE s.user_id = $1::uuid`,
          [safeUserId]
        )
        : await queryOne<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM messages"
        );
      return row?.count ?? 0;
    } catch (error) {
      logger.error("getTotalMessages failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }
  async getTotalDocuments(userId?: string | null): Promise<number> {
    try {
      const safeUserId =
        typeof userId === "string" && /^[0-9a-f-]{36}$/i.test(userId)
          ? userId
          : null;
      const row = safeUserId
        ? await queryOne<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM documents WHERE user_id = $1::uuid",
          [safeUserId]
        )
        : await queryOne<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM documents"
        );
      return row?.count ?? 0;
    } catch (error) {
      logger.error("getTotalDocuments failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getTotalSessions(userId?: string | null): Promise<number> {
    try {
      const safeUserId =
        typeof userId === "string" && /^[0-9a-f-]{36}$/i.test(userId)
          ? userId
          : null;
      const row = safeUserId
        ? await queryOne<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = $1::uuid",
          [safeUserId]
        )
        : await queryOne<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM sessions"
        );
      return row?.count ?? 0;
    } catch (error) {
      logger.error("getTotalSessions failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private async storeDocumentInline(
    filename: string,
    fileType: string,
    content: string
  ): Promise<string> {
    const row = await queryOne<{ document_id: string }>(
      `INSERT INTO documents (filename, file_type, content, s3_key)
       VALUES ($1, $2, $3, NULL)
       RETURNING document_id`,
      [filename, fileType, content]
    );
    return row?.document_id ?? "";
  }

  private async storeDocumentInS3(
    filename: string,
    fileType: string,
    content: string
  ): Promise<string> {
    const timestamp = Date.now();
    const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const s3Key = `${S3_KEY_PREFIX}${timestamp}_${safeFilename}`;
    try {
      await this.s3Client.upload(
        s3Key,
        Buffer.from(content, "utf-8"),
        "text/plain"
      );
      const contentPreview = content.substring(0, 500);
      const row = await queryOne<{ document_id: string }>(
        `INSERT INTO documents (filename, file_type, content, s3_key)
         VALUES ($1, $2, $3, $4)
         RETURNING document_id`,
        [filename, fileType, contentPreview, s3Key]
      );
      logger.info("Document stored in S3", {
        filename,
        s3Key,
        contentSize: Buffer.byteLength(content, "utf-8"),
      });
      return row?.document_id ?? "";
    } catch (error) {
      logger.error("storeDocumentInS3 failed, falling back to inline", {
        filename,
        s3Key,
        error: (error as Error).message,
      });
      return this.storeDocumentInline(filename, fileType, content);
    }
  }
}

let rawStoreInstance: RawStore | null = null;

export function getRawStore(): RawStore {
  if (!rawStoreInstance) {
    rawStoreInstance = new RawStore();
  }
  return rawStoreInstance;
}