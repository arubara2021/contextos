import config from "../config";
import logger from "../utils/logger";
import type { BucketRow } from "../models/bucket.model";
import { queryMany, query } from "../database";

export interface ThresholdCrossing {
  bucketId: string;
  canonical: string;
  previousStrength: number;
  currentStrength: number;
  crossedThreshold: "strong" | "fading" | "critical" | "forgotten" | null;
  direction: "up" | "down";
  importance: number;
  lastAccessed: Date;
}

export interface DecayCurvePoint {
  day: number;
  strength: number;
}

export function getDecayRate(importance: number): number {
  if (importance >= 8) return config.decay.highImportanceRate;
  if (importance >= 5) return config.decay.defaultRate;
  return config.decay.lowImportanceRate;
}

export function computeStrength(
  initialStrength: number,
  decayRate: number,
  daysSinceAccess: number
): number {
  if (daysSinceAccess <= 0) return initialStrength;
  const decayed = initialStrength * Math.pow(1 - decayRate, daysSinceAccess);
  return Math.max(0, Math.min(1, Math.round(decayed * 10000) / 10000));
}

export function refreshStrength(
  currentStrength: number,
  accessBoost: number = 1.0
): number {
  const retained = currentStrength * config.decay.retainWeight;
  const boosted = accessBoost * config.decay.accessBoostWeight;
  return Math.min(1, Math.round((retained + boosted) * 10000) / 10000);
}

export function categorize(strength: number): "strong" | "fading" | "critical" | "forgotten" {
  if (strength >= config.decay.strongThreshold) return "strong";
  if (strength >= config.decay.fadingThreshold) return "fading";
  if (strength >= config.decay.forgottenThreshold) return "critical";
  return "forgotten";
}

export function getCurrentStrength(bucket: {
  strength: number;
  decayRate: number;
  lastAccessed: Date;
}): number {
  const now = Date.now();
  const lastAccess = new Date(bucket.lastAccessed).getTime();
  const daysSinceAccess = (now - lastAccess) / (1000 * 60 * 60 * 24);
  return computeStrength(bucket.strength, bucket.decayRate, daysSinceAccess);
}

export function getDecayCurve(
  initialStrength: number,
  decayRate: number,
  days: number
): DecayCurvePoint[] {
  const points: DecayCurvePoint[] = [];
  for (let day = 0; day <= days; day++) {
    points.push({
      day,
      strength: computeStrength(initialStrength, decayRate, day),
    });
  }
  return points;
}

export class DecayEngine {
  async runDecayScan(): Promise<ThresholdCrossing[]> {
    const start = Date.now();
    const crossings: ThresholdCrossing[] = [];

    try {
      const rows = await queryMany<BucketRow>(
        "SELECT * FROM buckets"
      );

      for (const row of rows) {
        const previousStrength = Number(row.strength);
        const decayRate = Number(row.decay_rate);
        const lastAccessed = new Date(row.last_accessed);
        const now = Date.now();
        const daysSinceAccess = (now - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);

        const currentStrength = computeStrength(previousStrength, decayRate, daysSinceAccess);

        if (Math.abs(currentStrength - previousStrength) < 0.001) {
          continue;
        }

        const previousCategory = categorize(previousStrength);
        const currentCategory = categorize(currentStrength);

        try {
          await query(
            "UPDATE buckets SET strength = $1 WHERE bucket_id = $2",
            [currentStrength, row.bucket_id]
          );
        } catch (updateError) {
          logger.debug("Failed to update bucket strength", {
            bucketId: row.bucket_id,
            error: (updateError as Error).message,
          });
          continue;
        }

        if (previousCategory !== currentCategory) {
          crossings.push({
            bucketId: row.bucket_id,
            canonical: row.canonical,
            previousStrength,
            currentStrength,
            crossedThreshold: currentCategory,
            direction: currentStrength < previousStrength ? "down" : "up",
            importance: Number(row.importance),
            lastAccessed,
          });
        }
      }

      const durationMs = Date.now() - start;

      logger.info("Decay scan complete", {
        bucketsScanned: rows.length,
        crossingsDetected: crossings.length,
        durationMs,
      });

      return crossings;
    } catch (error) {
      logger.error("Decay scan failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getBucketsByCategory(): Promise<{
    strong: Array<{ bucketId: string; canonical: string; strength: number }>;
    fading: Array<{ bucketId: string; canonical: string; strength: number }>;
    critical: Array<{ bucketId: string; canonical: string; strength: number }>;
    forgotten: Array<{ bucketId: string; canonical: string; strength: number }>;
  }> {
    try {
      const rows = await queryMany<BucketRow>(
        "SELECT * FROM buckets"
      );

      const result = {
        strong: [] as Array<{ bucketId: string; canonical: string; strength: number }>,
        fading: [] as Array<{ bucketId: string; canonical: string; strength: number }>,
        critical: [] as Array<{ bucketId: string; canonical: string; strength: number }>,
        forgotten: [] as Array<{ bucketId: string; canonical: string; strength: number }>,
      };

      for (const row of rows) {
        const currentStrength = getCurrentStrength({
          strength: Number(row.strength),
          decayRate: Number(row.decay_rate),
          lastAccessed: new Date(row.last_accessed),
        });

        const category = categorize(currentStrength);
        result[category].push({
          bucketId: row.bucket_id,
          canonical: row.canonical,
          strength: currentStrength,
        });
      }

      return result;
    } catch (error) {
      logger.error("getBucketsByCategory failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getAverageStrength(): Promise<number> {
    try {
      const rows = await queryMany<BucketRow>(
        "SELECT strength, decay_rate, last_accessed FROM buckets"
      );

      if (rows.length === 0) return 0;

      let total = 0;
      for (const row of rows) {
        total += getCurrentStrength({
          strength: Number(row.strength),
          decayRate: Number(row.decay_rate),
          lastAccessed: new Date(row.last_accessed),
        });
      }

      return Math.round((total / rows.length) * 10000) / 10000;
    } catch (error) {
      logger.error("getAverageStrength failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getDecayCurveForBucket(bucketId: string, days: number = 30): Promise<DecayCurvePoint[]> {
    try {
      const row = await queryMany<BucketRow>(
        "SELECT strength, decay_rate FROM buckets WHERE bucket_id = $1",
        [bucketId]
      );

      if (row.length === 0) {
        return [];
      }

      const currentStrength = Number(row[0].strength);
      const decayRate = Number(row[0].decay_rate);

      return getDecayCurve(currentStrength, decayRate, days);
    } catch (error) {
      logger.error("getDecayCurveForBucket failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}

let decayEngineInstance: DecayEngine | null = null;

export function getDecayEngine(): DecayEngine {
  if (!decayEngineInstance) {
    decayEngineInstance = new DecayEngine();
  }
  return decayEngineInstance;
}