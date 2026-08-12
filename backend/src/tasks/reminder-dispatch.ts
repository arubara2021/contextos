import { query, queryMany } from "../database";
import config from "../config";
import logger from "../utils/logger";

const REMINDER_SCAN_INTERVAL_MS =
  config.reminder.checkIntervalHours * 60 * 60 * 1000;

let reminderTimer: ReturnType<typeof setInterval> | null = null;

interface CriticalMemoryRow {
  user_id: string;
  bucket_id: string;
  canonical: string;
  strength: number;
  importance: number;
  concept_type: string;
}

async function runReminderDispatch(): Promise<void> {
  try {
    const criticalMemories = await queryMany<CriticalMemoryRow>(
      `SELECT b.user_id, b.bucket_id, b.canonical, b.strength,
              b.importance, b.concept_type
       FROM buckets b
       WHERE b.strength < $1
       AND b.strength >= $2
       AND b.importance >= $3
       AND b.user_id IS NOT NULL
       ORDER BY b.user_id, b.importance DESC, b.strength ASC`,
      [
        config.memory.criticalThreshold,
        config.memory.forgottenThreshold,
        config.reminder.minImportance,
      ]
    );

    if (criticalMemories.length === 0) return;

    const byUser = new Map<string, CriticalMemoryRow[]>();

    for (const memory of criticalMemories) {
      if (!byUser.has(memory.user_id)) {
        byUser.set(memory.user_id, []);
      }
      byUser.get(memory.user_id)!.push(memory);
    }

    let created = 0;

    for (const [userId, memories] of byUser.entries()) {
      const recentReminder = await query(
        `SELECT reminder_id
         FROM reminders
         WHERE user_id = $1
         AND dismissed = false
         AND action_taken IS NULL
         AND created_at > now() - interval '24 hours'`,
        [userId]
      );

      if ((recentReminder.rowCount ?? 0) > 0) continue;

      const topMemories = memories.slice(0, config.reminder.maxTopicsShown);
      const labels = topMemories.map((m) => m.canonical).join(", ");

      await query(
        `INSERT INTO reminders (user_id, message, memories, dismissed)
         VALUES ($1, $2, $3, false)`,
        [
          userId,
          `These important memories are fading and may need attention: ${labels}`,
          JSON.stringify(
            topMemories.map((m) => ({
              bucketId: m.bucket_id,
              label: m.canonical,
              strength: Math.round(m.strength * 100) / 100,
              importance: m.importance,
              conceptType: m.concept_type,
            }))
          ),
        ]
      );

      created++;
    }

    if (created > 0) {
      logger.info("Reminder dispatch complete", {
        remindersCreated: created,
        usersAffected: byUser.size,
        totalCriticalMemories: criticalMemories.length,
      });
    }
  } catch (error) {
    logger.error("Reminder dispatch failed", {
      error: (error as Error).message,
    });
  }
}

export function startReminderDispatch(): void {
  if (reminderTimer) return;
  reminderTimer = setInterval(runReminderDispatch, REMINDER_SCAN_INTERVAL_MS);
  reminderTimer.unref();
  logger.info("Reminder dispatch started", {
    intervalMs: REMINDER_SCAN_INTERVAL_MS,
  });
  runReminderDispatch();
}

export function stopReminderDispatch(): void {
  if (reminderTimer) {
    clearInterval(reminderTimer);
    reminderTimer = null;
  }
}