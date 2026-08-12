import config from "../config";
import logger from "../utils/logger";
import {
  categorize,
  getCurrentStrength,
  refreshStrength,
  getDecayRate,
  computeStrength,
  getDecayCurve,
  DecayEngine,
  ThresholdCrossing,
  DecayCurvePoint,
} from "./decay";
import { query, queryMany } from "../database";
import type { BucketRow } from "../models/bucket.model";

export type StrengthCategory = "strong" | "fading" | "critical" | "forgotten";

export interface BucketStatus {
  bucketId: string;
  canonical: string;
  storedStrength: number;
  currentStrength: number;
  category: StrengthCategory;
  decayRate: number;
  importance: number;
  lastAccessed: Date;
  accessCount: number;
  daysSinceAccess: number;
}

export interface BulkStatusResult {
  statuses: BucketStatus[];
  summary: {
    strong: number;
    fading: number;
    critical: number;
    forgotten: number;
    total: number;
    averageStrength: number;
  };
}

export interface MemoriesByCategory {
  strong: BucketStatus[];
  fading: BucketStatus[];
  critical: BucketStatus[];
  forgotten: BucketStatus[];
}

export class StrengthTracker {
  private readonly decayEngine: DecayEngine;

  constructor(decayEngine?: DecayEngine) {
    this.decayEngine = decayEngine ?? new DecayEngine();
  }

  async onAccess(bucketId: string, currentStrength: number): Promise<number> {
    try {
      const newStrength = refreshStrength(currentStrength);

      await query(
        `UPDATE buckets
         SET strength = $1,
             last_accessed = now(),
             access_count = access_count + 1
         WHERE bucket_id = $2`,
        [newStrength, bucketId]
      );

      logger.debug("Strength refreshed on access", {
        bucketId,
        previousStrength: currentStrength,
        newStrength,
      });

      return newStrength;
    } catch (error) {
      logger.error("onAccess failed", {
        bucketId,
        currentStrength,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async onMultiAccess(bucketIds: string[]): Promise<number[]> {
    if (bucketIds.length === 0) return [];

    try {
      const rows = await queryMany<BucketRow>(
        `SELECT bucket_id, strength FROM buckets WHERE bucket_id = ANY($1)`,
        [bucketIds]
      );

      const strengthMap = new Map<string, number>();
      for (const row of rows) {
        strengthMap.set(row.bucket_id, Number(row.strength));
      }

      const results: number[] = [];

      for (const bucketId of bucketIds) {
        const currentStrength = strengthMap.get(bucketId) ?? 0.5;
        const newStrength = refreshStrength(currentStrength);

        await query(
          `UPDATE buckets
           SET strength = $1,
               last_accessed = now(),
               access_count = access_count + 1
           WHERE bucket_id = $2`,
          [newStrength, bucketId]
        );

        results.push(newStrength);
      }

      logger.debug("Multi-access strength refresh", {
        count: bucketIds.length,
      });

      return results;
    } catch (error) {
      logger.error("onMultiAccess failed", {
        count: bucketIds.length,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  getStatus(bucket: {
    bucketId: string;
    canonical: string;
    strength: number;
    decayRate: number;
    importance: number;
    lastAccessed: Date;
    accessCount: number;
  }): BucketStatus {
    const now = Date.now();
    const lastAccess = new Date(bucket.lastAccessed).getTime();
    const daysSinceAccess = (now - lastAccess) / (1000 * 60 * 60 * 24);
    const currentStrength = computeStrength(bucket.strength, bucket.decayRate, daysSinceAccess);
    const category = categorize(currentStrength);

    return {
      bucketId: bucket.bucketId,
      canonical: bucket.canonical,
      storedStrength: bucket.strength,
      currentStrength,
      category,
      decayRate: bucket.decayRate,
      importance: bucket.importance,
      lastAccessed: new Date(bucket.lastAccessed),
      accessCount: bucket.accessCount,
      daysSinceAccess: Math.round(daysSinceAccess * 10) / 10,
    };
  }

  async getStatusById(bucketId: string): Promise<BucketStatus | null> {
    try {
      const rows = await queryMany<BucketRow>(
        "SELECT * FROM buckets WHERE bucket_id = $1",
        [bucketId]
      );

      if (rows.length === 0) return null;

      const row = rows[0];
      return this.getStatus({
        bucketId: row.bucket_id,
        canonical: row.canonical,
        strength: Number(row.strength),
        decayRate: Number(row.decay_rate),
        importance: Number(row.importance),
        lastAccessed: new Date(row.last_accessed),
        accessCount: Number(row.access_count),
      });
    } catch (error) {
      logger.error("getStatusById failed", {
        bucketId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async bulkStatus(): Promise<BulkStatusResult> {
    try {
      const rows = await queryMany<BucketRow>(
        "SELECT * FROM buckets"
      );

      const statuses: BucketStatus[] = [];
      const summary = { strong: 0, fading: 0, critical: 0, forgotten: 0, total: 0, averageStrength: 0 };
      let totalStrength = 0;

      for (const row of rows) {
        const status = this.getStatus({
          bucketId: row.bucket_id,
          canonical: row.canonical,
          strength: Number(row.strength),
          decayRate: Number(row.decay_rate),
          importance: Number(row.importance),
          lastAccessed: new Date(row.last_accessed),
          accessCount: Number(row.access_count),
        });

        statuses.push(status);
        summary[status.category]++;
        summary.total++;
        totalStrength += status.currentStrength;
      }

      if (summary.total > 0) {
        summary.averageStrength = Math.round((totalStrength / summary.total) * 10000) / 10000;
      }

      return { statuses, summary };
    } catch (error) {
      logger.error("bulkStatus failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getMemoriesByCategory(): Promise<MemoriesByCategory> {
    try {
      const { statuses } = await this.bulkStatus();

      const result: MemoriesByCategory = {
        strong: [],
        fading: [],
        critical: [],
        forgotten: [],
      };

      for (const status of statuses) {
        result[status.category].push(status);
      }

      for (const category of Object.keys(result) as StrengthCategory[]) {
        result[category].sort((a, b) => b.currentStrength - a.currentStrength);
      }

      return result;
    } catch (error) {
      logger.error("getMemoriesByCategory failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getCriticalMemories(): Promise<BucketStatus[]> {
    try {
      const categories = await this.getMemoriesByCategory();
      return categories.critical;
    } catch (error) {
      logger.error("getCriticalMemories failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getStrongMemories(): Promise<BucketStatus[]> {
    try {
      const categories = await this.getMemoriesByCategory();
      return categories.strong;
    } catch (error) {
      logger.error("getStrongMemories failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getFadingMemories(): Promise<BucketStatus[]> {
    try {
      const categories = await this.getMemoriesByCategory();
      return categories.fading;
    } catch (error) {
      logger.error("getFadingMemories failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getForgottenMemories(): Promise<BucketStatus[]> {
    try {
      const categories = await this.getMemoriesByCategory();
      return categories.forgotten;
    } catch (error) {
      logger.error("getForgottenMemories failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getDecayCurveForBucket(bucketId: string, days: number = 30): Promise<DecayCurvePoint[]> {
    return this.decayEngine.getDecayCurveForBucket(bucketId, days);
  }

  async getStrengthDistribution(): Promise<{
    ranges: Array<{ label: string; min: number; max: number; count: number }>;
    total: number;
  }> {
    try {
      const { statuses, summary } = await this.bulkStatus();

      const ranges = [
        { label: "0.9 - 1.0", min: 0.9, max: 1.0, count: 0 },
        { label: "0.7 - 0.9", min: 0.7, max: 0.9, count: 0 },
        { label: "0.4 - 0.7", min: 0.4, max: 0.7, count: 0 },
        { label: "0.1 - 0.4", min: 0.1, max: 0.4, count: 0 },
        { label: "0.0 - 0.1", min: 0.0, max: 0.1, count: 0 },
      ];

      for (const status of statuses) {
        for (const range of ranges) {
          if (
            status.currentStrength >= range.min &&
            (range.max === 1.0 ? status.currentStrength <= range.max : status.currentStrength < range.max)
          ) {
            range.count++;
            break;
          }
        }
      }

      return { ranges, total: summary.total };
    } catch (error) {
      logger.error("getStrengthDistribution failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async runFullScan(): Promise<{
    crossings: ThresholdCrossing[];
    summary: BulkStatusResult["summary"];
  }> {
    try {
      const crossings = await this.decayEngine.runDecayScan();
      const { summary } = await this.bulkStatus();

      logger.info("Full strength scan complete", {
        crossings: crossings.length,
        ...summary,
      });

      return { crossings, summary };
    } catch (error) {
      logger.error("runFullScan failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async applyStrengthUpdate(bucketId: string, newStrength: number): Promise<void> {
    try {
      const clamped = Math.max(0, Math.min(1, newStrength));
      await query(
        "UPDATE buckets SET strength = $1 WHERE bucket_id = $2",
        [clamped, bucketId]
      );
    } catch (error) {
      logger.error("applyStrengthUpdate failed", {
        bucketId,
        newStrength,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}

let strengthTrackerInstance: StrengthTracker | null = null;

export function getStrengthTracker(): StrengthTracker {
  if (!strengthTrackerInstance) {
    strengthTrackerInstance = new StrengthTracker();
  }
  return strengthTrackerInstance;
}