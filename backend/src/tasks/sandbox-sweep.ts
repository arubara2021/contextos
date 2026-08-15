import { query, queryMany } from "../database";
import logger from "../utils/logger";

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const SHARED_SANDBOX_EMAIL = process.env.SANDBOX_SHARED_EMAIL ?? "shared-demo@contextos.local";

let sweepTimer: ReturnType<typeof setInterval> | null = null;

async function purgeSandbox(uid: string): Promise<void> {
  const docRows = await queryMany<{ document_id: string }>(
    "SELECT document_id FROM documents WHERE user_id = $1",
    [uid]
  );
  const docIds = docRows.map((r) => r.document_id);

  const bucketRows = await queryMany<{ bucket_id: string; canonical: string }>(
    `SELECT bucket_id, canonical FROM buckets
         WHERE user_id = $1
            OR ($2::uuid[] IS NOT NULL AND document_id = ANY($2::uuid[]))`,
    [uid, docIds.length > 0 ? docIds : null]
  );
  const bucketIds = bucketRows.map((r) => r.bucket_id);
  const canonicals = bucketRows.map((r) => r.canonical);

  if (bucketIds.length > 0) {
    await query(
      "DELETE FROM embeddings WHERE bucket_id = ANY($1::uuid[])",
      [bucketIds]
    );
    await query(
      "DELETE FROM bucket_items WHERE bucket_id = ANY($1::uuid[])",
      [bucketIds]
    );
  }

  if (canonicals.length > 0) {
    await query(
      `DELETE FROM relationships
             WHERE source_bucket = ANY($1::text[]) OR target_bucket = ANY($1::text[])`,
      [canonicals]
    );
  }

  if (bucketIds.length > 0) {
    await query("DELETE FROM buckets WHERE bucket_id = ANY($1::uuid[])", [bucketIds]);
  }

  await query("DELETE FROM documents WHERE user_id = $1", [uid]);
  await query("DELETE FROM users WHERE user_id = $1", [uid]);
}

async function deleteExpiredSandboxes(): Promise<number> {
  const expired = await queryMany<{ user_id: string; email: string }>(
    `SELECT user_id, email FROM users
         WHERE is_sandbox = true
           AND expires_at IS NOT NULL
           AND expires_at < now()
           AND email <> $1`,
    [SHARED_SANDBOX_EMAIL]
  );

  if (expired.length === 0) return 0;

  let totalCleaned = 0;
  for (const sandbox of expired) {
    await purgeSandbox(sandbox.user_id);
    totalCleaned++;
    logger.info("Sandbox expired and cleaned", {
      userId: sandbox.user_id,
      email: sandbox.email,
    });
  }

  return totalCleaned;
}

async function runSweep(): Promise<void> {
  try {
    const cleaned = await deleteExpiredSandboxes();
    if (cleaned > 0) {
      logger.info("Sandbox sweep complete", { expiredCleaned: cleaned });
    }
  } catch (error) {
    logger.error("Sandbox sweep failed", {
      error: (error as Error).message,
    });
  }
}

export function startSandboxSweep(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(runSweep, SWEEP_INTERVAL_MS);
  sweepTimer.unref();
  logger.info("Sandbox sweep started", { intervalMs: SWEEP_INTERVAL_MS });
  runSweep();
}

export function stopSandboxSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}