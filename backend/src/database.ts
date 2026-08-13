import {
  Pool,
  PoolClient,
  PoolConfig,
  QueryResult,
  QueryResultRow,
} from "pg";
import config from "./config";
import { readFileSync } from "fs";
import { join } from "path";
import logger from "./utils/logger";

let pool: Pool | null = null;

const TRANSIENT_ERROR_CODES = new Set([
  "40001",
  "40003",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "57P01",
  "57P02",
  "57P03",
  "57P04",
  "XX000",
]);

const NON_RETRYABLE_PATTERNS: RegExp[] = [
  /syntax error/i,
  /does not exist/i,
  /constraint/i,
  /duplicate key/i,
  /unique/i,
  /check constraint/i,
  /invalid/i,
  /permission denied/i,
  /column/i,
  /relation/i,
  /type/i,
];

const TRANSIENT_PATTERNS: RegExp[] = [
  /timeout/i,
  /timed out/i,
  /connection terminated/i,
  /connection refused/i,
  /connection reset/i,
  /serialization/i,
  /restart/i,
  /retry/i,
  /ambiguous/i,
  /network/i,
  /socket/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
];

function clampPoolMax(value: unknown): number {
  const num = Number(value);

  if (!Number.isFinite(num)) return 15;

  return Math.max(10, Math.min(20, Math.floor(num)));
}

function clampTimeout(value: unknown, min: number, max: number, fallback: number): number {
  const num = Number(value);

  if (!Number.isFinite(num)) return fallback;

  return Math.max(min, Math.min(max, Math.floor(num)));
}

function previewQuery(text: string): string {
  return text
    .replace(/\[[^\]]{80,}\]/g, "[vector]")
    .replace(/\s+/g, " ")
    .trim()
    .substring(0, 200);
}

function isTransientError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };

  if (!err) return false;

  if (err.code && TRANSIENT_ERROR_CODES.has(String(err.code))) {
    return true;
  }

  const message = String(err.message || "");

  if (NON_RETRYABLE_PATTERNS.some((pattern) => pattern.test(message))) {
    return false;
  }

  return TRANSIENT_PATTERNS.some((pattern) => pattern.test(message));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(task: () => Promise<T>, label: string): Promise<T> {
  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      if (!isTransientError(error) || attempt === maxRetries) {
        break;
      }

      const delay = 100 * Math.pow(2, attempt) + Math.floor(Math.random() * 50);

      logger.warn("Retrying transient database operation", {
        label,
        attempt: attempt + 1,
        delayMs: delay,
        error: (error as Error).message,
      });

      await sleep(delay);
    }
  }

  throw lastError;
}

function buildPoolConfig(): PoolConfig {
  const poolConfig = {
    connectionString: config.cockroach.connectionString,
    max: clampPoolMax(config.cockroach.maxConnections),
    idleTimeoutMillis: clampTimeout(
      config.cockroach.idleTimeoutMs,
      10000,
      60000,
      30000
    ),
    connectionTimeoutMillis: clampTimeout(
      config.cockroach.connectionTimeoutMs,
      15000,
      30000,
      20000
    ),
    statement_timeout: clampTimeout(
      config.cockroach.statementTimeoutMs,
      10000,
      60000,
      30000
    ),
    query_timeout: clampTimeout(
      config.cockroach.statementTimeoutMs,
      10000,
      60000,
      30000
    ),
    application_name: "contextos-backend",
    keepAlive: true,
  } as PoolConfig;

  return poolConfig;
}

export function initPool(): Pool {
  if (pool) return pool;

  pool = new Pool(buildPoolConfig());

  pool.on("error", (err) => {
    logger.error("Unexpected pool error", {
      message: err.message,
      stack: err.stack,
    });
  });

  pool.on("connect", () => {
    logger.debug("New client connected to CockroachDB");
  });

  pool.on("remove", () => {
    logger.debug("Client removed from pool");
  });

  logger.info("Database pool initialized", {
    maxConnections: clampPoolMax(config.cockroach.maxConnections),
  });

  return pool;
}

export function getPool(): Pool {
  if (!pool) {
    throw new Error("Database pool not initialized. Call initPool() first.");
  }

  return pool;
}

export async function getClient(): Promise<PoolClient> {
  return getPool().connect();
}

export async function query<
  T extends QueryResultRow = Record<string, unknown>
>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  const start = Date.now();

  try {
    return await withRetry(async () => {
      const result = await getPool().query<T>(text, params);
      const duration = Date.now() - start;

      if (duration > 1000) {
        logger.warn("Slow query detected", {
          text: previewQuery(text),
          duration,
          rowCount: result.rowCount,
        });
      }

      return result;
    }, "query");
  } catch (error) {
    logger.error("Query failed", {
      text: previewQuery(text),
      paramCount: params?.length ?? 0,
      error: (error as Error).message,
    });

    throw error;
  }
}

export async function queryOne<
  T extends QueryResultRow = Record<string, unknown>
>(text: string, params?: unknown[]): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

export async function queryMany<
  T extends QueryResultRow = Record<string, unknown>
>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

export async function withClient<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();

  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  return withRetry(async () => {
    const client = await getClient();

    try {
      await client.query("BEGIN");

      const result = await fn(client);

      await client.query("COMMIT");

      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        logger.error("Rollback failed", {
          error: (rollbackError as Error).message,
        });
      }

      throw error;
    } finally {
      client.release();
    }
  }, "transaction");
}

export async function executeInTransaction(
  client: PoolClient,
  statements: Array<{ text: string; params?: unknown[] }>
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];

  for (const statement of statements) {
    const result = await client.query(statement.text, statement.params);
    results.push(result);
  }

  return results;
}

async function initializeVectorIndex(): Promise<void> {
  try {
    await query(
      "CREATE VECTOR INDEX IF NOT EXISTS idx_embeddings_vector ON embeddings (vector)"
    );

    logger.info("Vector index created or verified");
  } catch (error) {
    const message = (error as Error).message;

    if (message.includes("already exists")) {
      return;
    }

    logger.warn("Vector index creation failed, search may use brute-force", {
      error: message,
    });
  }
}

export async function initDatabase(): Promise<void> {
  // Quick check: if the users table exists, skip all schema creation
  try {
    const check = await query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public' LIMIT 1"
    );
    if (check.rows.length > 0) {
      logger.info("Database schema already exists, skipping init");
      await initializeVectorIndex();
      return;
    }
  } catch {
    // If check fails, fall through to full init
  }

  const schemaPath = join(__dirname, "scripts", "init-db.sql");

  let schema: string;

  try {
    schema = readFileSync(schemaPath, "utf-8");
  } catch (error) {
    const err = error as Error;
    logger.error("Failed to read schema file", {
      path: schemaPath,
      error: err.message,
    });
    throw new Error(
      `Cannot read database schema at ${schemaPath}: ${err.message}`
    );
  }

  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  logger.info("Initializing database", {
    statementCount: statements.length,
  });

  let executed = 0;
  let skipped = 0;
  let failed = 0;

  for (const statement of statements) {
    try {
      await query(statement);
      executed++;
    } catch (error) {
      const err = error as Error;
      if (
        err.message.includes("already exists") ||
        err.message.includes("duplicate") ||
        (err.message.includes("relation") &&
          err.message.includes("already exists"))
      ) {
        skipped++;
        continue;
      }
      failed++;
      logger.error("Schema statement failed", {
        statement: previewQuery(statement),
        error: err.message,
      });
      throw error;
    }
  }

  await initializeVectorIndex();

  logger.info("Database initialization complete", {
    executed,
    skipped,
    failed,
  });
}

export async function closePool(): Promise<void> {
  if (!pool) return;

  try {
    await pool.end();
    pool = null;

    logger.info("Database pool closed");
  } catch (error) {
    logger.error("Error closing database pool", {
      error: (error as Error).message,
    });

    pool = null;

    throw error;
  }
}

export async function healthCheck(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();

  try {
    await query("SELECT 1");

    return { healthy: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - start,
      error: (error as Error).message,
    };
  }
}

export async function getPoolStats(): Promise<{
  totalCount: number;
  idleCount: number;
  waitingCount: number;
}> {
  const activePool = getPool();

  return {
    totalCount: activePool.totalCount,
    idleCount: activePool.idleCount,
    waitingCount: activePool.waitingCount,
  };
}