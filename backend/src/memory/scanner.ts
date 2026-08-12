import logger from "../utils/logger";
import { DecayEngine, ThresholdCrossing } from "./decay";
import { StrengthTracker, BulkStatusResult } from "./strength-tracker";
import { ReminderEngine } from "./reminder-engine";

type ReminderCheckResult = {
  hasReminders: boolean;
  reminder: any;
  criticalCount: number;
};
import { getRelationshipStore } from "../storage/relationship-store";

export interface ScanSummary {
  decay: {
    bucketsScanned: number;
    crossingsDetected: number;
    crossings: ThresholdCrossing[];
  };
  strength: BulkStatusResult["summary"];
  reminders: {
    criticalCount: number;
    reminderGenerated: boolean;
  };
  cleanup: {
    orphanedRelationships: number;
  };
  durationMs: number;
}

export class Scanner {
  private readonly decayEngine: DecayEngine;
  private readonly strengthTracker: StrengthTracker;
  private readonly reminderEngine: ReminderEngine;

  constructor(
    decayEngine?: DecayEngine,
    strengthTracker?: StrengthTracker,
    reminderEngine?: ReminderEngine
  ) {
    this.decayEngine = decayEngine ?? new DecayEngine();
    this.strengthTracker = strengthTracker ?? new StrengthTracker(this.decayEngine);
    this.reminderEngine = reminderEngine ?? new ReminderEngine();
  }

  async runFullScan(userId?: string): Promise<ScanSummary> {
    const start = Date.now();

    logger.info("Starting full scan");

    const decayResult = await this.runDecayScan();
    const strengthResult = await this.runStrengthScan();
    const reminderResult = await this.runReminderScan(userId);
    const cleanupResult = await this.runCleanupScan();

    const durationMs = Date.now() - start;

    const summary: ScanSummary = {
      decay: {
        bucketsScanned: 0,
        crossingsDetected: decayResult.length,
        crossings: decayResult,
      },
      strength: strengthResult,
      reminders: reminderResult,
      cleanup: cleanupResult,
      durationMs,
    };

    logger.info("Full scan complete", {
      crossings: summary.decay.crossingsDetected,
      strong: summary.strength.strong,
      critical: summary.strength.critical,
      remindersGenerated: summary.reminders.reminderGenerated,
      orphanedCleaned: summary.cleanup.orphanedRelationships,
      durationMs,
    });

    return summary;
  }

  async runDecayScan(): Promise<ThresholdCrossing[]> {
    try {
      return await this.decayEngine.runDecayScan();
    } catch (error) {
      logger.error("Decay scan failed in scanner", {
        error: (error as Error).message,
      });
      return [];
    }
  }

  async runStrengthScan(): Promise<BulkStatusResult["summary"]> {
    try {
      const { summary } = await this.strengthTracker.bulkStatus();
      return summary;
    } catch (error) {
      logger.error("Strength scan failed in scanner", {
        error: (error as Error).message,
      });
      return {
        strong: 0,
        fading: 0,
        critical: 0,
        forgotten: 0,
        total: 0,
        averageStrength: 0,
      };
    }
  }

  async runReminderScan(userId?: string): Promise<{
    criticalCount: number;
    reminderGenerated: boolean;
  }> {
    try {
      const critical = await this.reminderEngine.scanForCriticalMemories();

      if (critical.length === 0) {
        return { criticalCount: 0, reminderGenerated: false };
      }

      if (!userId) {
        return { criticalCount: critical.length, reminderGenerated: false };
      }

      const result = await this.reminderEngine.checkAndGenerate(userId);

      return {
        criticalCount: critical.length,
        reminderGenerated: result.hasReminders && result.reminder !== null,
      };
    } catch (error) {
      logger.error("Reminder scan failed in scanner", {
        error: (error as Error).message,
      });
      return { criticalCount: 0, reminderGenerated: false };
    }
  }

  async runCleanupScan(): Promise<{ orphanedRelationships: number }> {
    try {
      const relationshipStore = getRelationshipStore();
      const deleted = await relationshipStore.cleanupOrphaned();
      return { orphanedRelationships: deleted };
    } catch (error) {
      logger.error("Cleanup scan failed in scanner", {
        error: (error as Error).message,
      });
      return { orphanedRelationships: 0 };
    }
  }

  async getScanStatus(): Promise<{
    lastDecayScan: Date | null;
    lastStrengthScan: Date | null;
    lastCleanupScan: Date | null;
  }> {
    try {
      const { summary } = await this.strengthTracker.bulkStatus();

      return {
        lastDecayScan: new Date(),
        lastStrengthScan: new Date(),
        lastCleanupScan: new Date(),
      };
    } catch (error) {
      logger.error("getScanStatus failed", {
        error: (error as Error).message,
      });
      return {
        lastDecayScan: null,
        lastStrengthScan: null,
        lastCleanupScan: null,
      };
    }
  }
}

let scannerInstance: Scanner | null = null;

export function getScanner(): Scanner {
  if (!scannerInstance) {
    scannerInstance = new Scanner();
  }
  return scannerInstance;
}