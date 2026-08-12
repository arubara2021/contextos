import { query, queryOne } from "../database";
import config from "../config";
import logger from "../utils/logger";

const DECAY_SCAN_INTERVAL_MS = 4 * 60 * 60 * 1000;

let decayTimer: ReturnType<typeof setInterval> | null = null;

async function runDecayScan(): Promise<void> {
  try {
    const result = await query(
      `UPDATE buckets
       SET strength = GREATEST(0.0, strength * POWER(
         1.0 - CASE
           WHEN importance >= 8 THEN $1::float8
           WHEN importance <= 3 THEN $2::float8
           ELSE $3::float8
         END,
         GREATEST(0.0, EXTRACT(EPOCH FROM (now() - last_accessed)) / 86400.0)
       ))
       WHERE strength > 0.001
       AND EXTRACT(EPOCH FROM (now() - last_accessed)) > 86400`,
      [
        config.decay.highImportanceRate,
        config.decay.lowImportanceRate,
        config.decay.defaultRate,
      ]
    );

    const updated = result.rowCount ?? 0;

    if (updated > 0) {
      const stats = await queryOne<{
        strong: number;
        fading: number;
        critical: number;
        forgotten: number;
      }>(
        `SELECT
          COUNT(*) FILTER (WHERE strength >= $1)::int AS strong,
          COUNT(*) FILTER (WHERE strength >= $2 AND strength < $1)::int AS fading,
          COUNT(*) FILTER (WHERE strength >= $3 AND strength < $2)::int AS critical,
          COUNT(*) FILTER (WHERE strength < $3)::int AS forgotten
         FROM buckets
         WHERE strength > 0`,
        [
          config.memory.strongThreshold,
          config.memory.criticalThreshold,
          config.memory.forgottenThreshold,
        ]
      );

      logger.info("Decay scan complete", {
        updated,
        strong: stats?.strong ?? 0,
        fading: stats?.fading ?? 0,
        critical: stats?.critical ?? 0,
        forgotten: stats?.forgotten ?? 0,
      });
    }
  } catch (error) {
    logger.error("Decay scan failed", {
      error: (error as Error).message,
    });
  }
}

export function startDecayScan(): void {
  if (decayTimer) return;
  decayTimer = setInterval(runDecayScan, DECAY_SCAN_INTERVAL_MS);
  decayTimer.unref();
  logger.info("Decay scan started", {
    intervalMs: DECAY_SCAN_INTERVAL_MS,
  });
  runDecayScan();
}

export function stopDecayScan(): void {
  if (decayTimer) {
    clearInterval(decayTimer);
    decayTimer = null;
  }
}