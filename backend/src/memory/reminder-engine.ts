import config from "../config";
import logger from "../utils/logger";
import { query, queryOne, queryMany } from "../database";
import {
  Reminder,
  ReminderRow,
  ReminderMemory,
  ReminderCheckResult,
  Contradiction,
  ContradictionRow,
  ContradictionCheckResult,
  createReminder,
  mapRowToReminder,
  mapRowToContradiction,
  emptyReminderCheck,
  emptyContradictionCheck,
  serializeReminderMemories,
  deserializeReminderMemories,
} from "../models/reminder.model";
import { categorize, getCurrentStrength } from "./decay";
import type { BucketRow } from "../models/bucket.model";
import { v4 as uuidv4 } from "uuid";

interface BucketWithComputedStrength {
  bucketId: string;
  canonical: string;
  importance: number;
  strength: number;
  decayRate: number;
  lastAccessed: Date;
  computedStrength: number;
  category: string;
  daysSinceAccess: number;
}

export class ReminderEngine {
  async scanForCriticalMemories(): Promise<ReminderMemory[]> {
    try {
      const rows = await queryMany<BucketRow>(
        "SELECT * FROM buckets WHERE importance >= $1",
        [config.reminder.minImportance]
      );

      const criticalMemories: ReminderMemory[] = [];

      for (const row of rows) {
        const strength = Number(row.strength);
        const decayRate = Number(row.decay_rate);
        const lastAccessed = new Date(row.last_accessed);
        const now = Date.now();
        const daysSinceAccess = (now - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
        const computedStrength = getCurrentStrength({ strength, decayRate, lastAccessed });
        const category = categorize(computedStrength);

        if (category === "critical" || category === "forgotten") {
          criticalMemories.push({
            bucketId: row.bucket_id,
            canonical: row.canonical,
            strength: computedStrength,
            importance: Number(row.importance),
            daysSinceAccess: Math.round(daysSinceAccess * 10) / 10,
          });
        }
      }

      criticalMemories.sort((a, b) => {
        const importanceDiff = b.importance - a.importance;
        if (importanceDiff !== 0) return importanceDiff;
        return a.strength - b.strength;
      });

      logger.debug("Critical memory scan complete", {
        totalScanned: rows.length,
        criticalFound: criticalMemories.length,
      });

      return criticalMemories;
    } catch (error) {
      logger.error("scanForCriticalMemories failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async generateReminder(
    userId: string,
    criticalMemories: ReminderMemory[]
  ): Promise<Reminder> {
    if (criticalMemories.length === 0) {
      throw new Error("Cannot generate reminder from empty critical memories");
    }

    const topMemories = criticalMemories.slice(0, config.reminder.maxTopicsShown);
    const reminder = createReminder({ userId, memories: topMemories });

    try {
      const reminderId = uuidv4();
      const memoriesJson = serializeReminderMemories(reminder.memories);

      await query(
        `INSERT INTO reminders (reminder_id, user_id, message, memories, dismissed)
         VALUES ($1, $2, $3, $4::jsonb, false)`,
        [reminderId, userId, reminder.message, memoriesJson]
      );

      reminder.reminderId = reminderId;

      logger.info("Reminder generated", {
        reminderId,
        userId,
        memoryCount: topMemories.length,
      });

      return reminder;
    } catch (error) {
      logger.error("generateReminder failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async checkForContradictions(
    newLabel: string,
    newDefinition: string,
    existingBuckets: Array<{ bucketId: string; canonical: string; definition: string }>
  ): Promise<Contradiction[]> {
    const contradictions: Contradiction[] = [];
    const normalizedNew = newLabel.toLowerCase().trim();

    for (const bucket of existingBuckets) {
      const normalizedExisting = bucket.canonical.toLowerCase().trim();

      if (normalizedExisting !== normalizedNew) continue;
      if (!bucket.definition || !newDefinition) continue;

      const isContradiction = await this.detectContradiction(
        bucket.definition,
        newDefinition
      );

      if (isContradiction) {
        contradictions.push({
          contradictionId: "",
          userId: "",
          existingBucketId: bucket.bucketId,
          newInformation: newDefinition,
          conflictDescription: `Conflicting definitions for "${newLabel}": existing says "${bucket.definition.substring(0, 100)}", new says "${newDefinition.substring(0, 100)}"`,
          resolved: false,
          createdAt: new Date(),
        });
      }
    }

    return contradictions;
  }

  async storeContradiction(
    contradiction: Contradiction,
    userId: string
  ): Promise<string> {
    try {
      const contradictionId = uuidv4();

      await query(
        `INSERT INTO contradictions (contradiction_id, user_id, existing_bucket_id, new_information, conflict_description, resolved)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [
          contradictionId,
          userId,
          contradiction.existingBucketId,
          contradiction.newInformation,
          contradiction.conflictDescription,
        ]
      );

      logger.debug("Contradiction stored", {
        contradictionId,
        existingBucketId: contradiction.existingBucketId,
      });

      return contradictionId;
    } catch (error) {
      logger.error("storeContradiction failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getActiveReminders(userId: string): Promise<Reminder[]> {
    try {
      const rows = await queryMany<ReminderRow>(
        `SELECT * FROM reminders
         WHERE user_id = $1 AND dismissed = false
         ORDER BY created_at DESC`,
        [userId]
      );

      return rows.map((row) => {
        const memories = deserializeReminderMemories(
          (row as ReminderRow & { memories: string | null }).memories ?? null
        );
        return mapRowToReminder(row, memories);
      });
    } catch (error) {
      logger.error("getActiveReminders failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getAllReminders(userId: string): Promise<Reminder[]> {
    try {
      const rows = await queryMany<ReminderRow>(
        `SELECT * FROM reminders
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId]
      );

      return rows.map((row) => {
        const memories = deserializeReminderMemories(
          (row as ReminderRow & { memories: string | null }).memories ?? null
        );
        return mapRowToReminder(row, memories);
      });
    } catch (error) {
      logger.error("getAllReminders failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async dismissReminder(reminderId: string): Promise<boolean> {
    try {
      const result = await query(
        `UPDATE reminders
         SET dismissed = true
         WHERE reminder_id = $1`,
        [reminderId]
      );

      const dismissed = (result.rowCount ?? 0) > 0;

      if (dismissed) {
        logger.debug("Reminder dismissed", { reminderId });
      }

      return dismissed;
    } catch (error) {
      logger.error("dismissReminder failed", {
        reminderId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async takeAction(reminderId: string, action: string): Promise<boolean> {
    try {
      const validActions = ["keep_active", "archive", "boost"];
      if (!validActions.includes(action)) {
        throw new Error(`Invalid action: ${action}. Must be one of: ${validActions.join(", ")}`);
      }

      const result = await query(
        `UPDATE reminders
         SET action_taken = $1, dismissed = true
         WHERE reminder_id = $2`,
        [action, reminderId]
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("takeAction failed", {
        reminderId,
        action,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async resolveContradiction(contradictionId: string): Promise<boolean> {
    try {
      const result = await query(
        `UPDATE contradictions
         SET resolved = true
         WHERE contradiction_id = $1`,
        [contradictionId]
      );

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("resolveContradiction failed", {
        contradictionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getUnresolvedContradictions(userId: string): Promise<Contradiction[]> {
    try {
      const rows = await queryMany<ContradictionRow>(
        `SELECT * FROM contradictions
         WHERE user_id = $1 AND resolved = false
         ORDER BY created_at DESC`,
        [userId]
      );

      return rows.map(mapRowToContradiction);
    } catch (error) {
      logger.error("getUnresolvedContradictions failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async checkAndGenerate(userId: string): Promise<ReminderCheckResult> {
    try {
      const critical = await this.scanForCriticalMemories();

      if (critical.length === 0) {
        return emptyReminderCheck();
      }

      const recentReminders = await this.getActiveReminders(userId);
      if (recentReminders.length > 0) {
        const lastReminder = recentReminders[0];
        const hoursSinceLastReminder =
          (Date.now() - lastReminder.createdAt.getTime()) / (1000 * 60 * 60);

        if (hoursSinceLastReminder < config.reminder.checkIntervalHours) {
          logger.debug("Skipping reminder: too recent", {
            hoursSinceLastReminder: Math.round(hoursSinceLastReminder * 10) / 10,
            required: config.reminder.checkIntervalHours,
          });
          return {
            hasReminders: true,
            reminder: lastReminder,
            criticalCount: critical.length,
          };
        }
      }

      const reminder = await this.generateReminder(userId, critical);

      return {
        hasReminders: true,
        reminder,
        criticalCount: critical.length,
      };
    } catch (error) {
      logger.error("checkAndGenerate failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  private async detectContradiction(
    existingDefinition: string,
    newDefinition: string
  ): Promise<boolean> {
    const existingLower = existingDefinition.toLowerCase();
    const newLower = newDefinition.toLowerCase();

    if (existingLower === newLower) return false;

    const negationPatterns = [
      { positive: "is", negative: "is not" },
      { positive: "can", negative: "cannot" },
      { positive: "does", negative: "does not" },
      { positive: "will", negative: "will not" },
      { positive: "should", negative: "should not" },
      { positive: "always", negative: "never" },
      { positive: "increases", negative: "decreases" },
      { positive: "enables", negative: "disables" },
      { positive: "true", negative: "false" },
      { positive: "correct", negative: "incorrect" },
      { positive: "valid", negative: "invalid" },
    ];

    for (const pattern of negationPatterns) {
      const existingHasPositive = existingLower.includes(pattern.positive);
      const newHasNegative = newLower.includes(pattern.negative);
      const existingHasNegative = existingLower.includes(pattern.negative);
      const newHasPositive = newLower.includes(pattern.positive);

      if ((existingHasPositive && newHasNegative) || (existingHasNegative && newHasPositive)) {
        return true;
      }
    }

    return false;
  }
}

let reminderEngineInstance: ReminderEngine | null = null;

export function getReminderEngine(): ReminderEngine {
  if (!reminderEngineInstance) {
    reminderEngineInstance = new ReminderEngine();
  }
  return reminderEngineInstance;
}