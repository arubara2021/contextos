import logger from "../utils/logger";
import { initPool, closePool, query, queryOne, queryMany } from "../database";
import {
  computeStrength,
  categorize,
  ThresholdCrossing,
} from "../memory/decay";

interface BucketRow {
  bucket_id: string;
  canonical: string;
  strength: number;
  decay_rate: number;
  importance: number;
  last_accessed: Date;
}

interface ScanResult {
  scanned: number;
  updated: number;
  crossings: ThresholdCrossing[];
  categories: {
    strong: number;
    fading: number;
    critical: number;
    forgotten: number;
  };
  durationMs: number;
}

async function runDecayScan(): Promise<ScanResult> {
  const start = Date.now();

  const rows = await queryMany<BucketRow>("SELECT * FROM buckets");

  console.log(`Scanning ${rows.length} buckets for decay...\n`);

  const crossings: ThresholdCrossing[] = [];
  let updated = 0;
  const categories = { strong: 0, fading: 0, critical: 0, forgotten: 0 };

  for (const row of rows) {
    const previousStrength = Number(row.strength);
    const decayRate = Number(row.decay_rate);
    const lastAccessed = new Date(row.last_accessed);
    const now = Date.now();
    const daysSinceAccess =
      (now - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);

    const currentStrength = computeStrength(
      previousStrength,
      decayRate,
      daysSinceAccess
    );

    const previousCategory = categorize(previousStrength);
    const currentCategory = categorize(currentStrength);
    categories[currentCategory]++;

    if (Math.abs(currentStrength - previousStrength) < 0.001) {
      continue;
    }

    try {
      await query(
        "UPDATE buckets SET strength = $1 WHERE bucket_id = $2",
        [currentStrength, row.bucket_id]
      );
      updated++;
    } catch (updateError) {
      logger.error("Failed to update bucket", {
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

  return {
    scanned: rows.length,
    updated,
    crossings,
    categories,
    durationMs,
  };
}

async function main(): Promise<void> {
  console.log("ContextOS Decay Scanner");
  console.log("=======================\n");

  try {
    initPool();

    const result = await runDecayScan();

    console.log("Results:");
    console.log(`  Scanned: ${result.scanned} buckets`);
    console.log(`  Updated: ${result.updated} strengths`);
    console.log(`  Threshold crossings: ${result.crossings.length}`);
    console.log(`  Duration: ${result.durationMs}ms`);
    console.log(`\nStrength distribution:`);
    console.log(`  Strong:   ${result.categories.strong}`);
    console.log(`  Fading:   ${result.categories.fading}`);
    console.log(`  Critical: ${result.categories.critical}`);
    console.log(`  Forgotten: ${result.categories.forgotten}`);

    if (result.crossings.length > 0) {
      console.log(`\nThreshold crossings:`);
      for (const crossing of result.crossings) {
        const arrow = crossing.direction === "down" ? "↓" : "↑";
        console.log(
          `  ${arrow} ${crossing.canonical}: ` +
            `${crossing.previousStrength.toFixed(3)} → ${crossing.currentStrength.toFixed(3)} ` +
            `(${crossing.crossedThreshold})`
        );
      }
    }

    const critical = result.crossings.filter(
      (c) =>
        c.crossedThreshold === "critical" ||
        c.crossedThreshold === "forgotten"
    );

    if (critical.length > 0) {
      console.log(`\n${critical.length} memories need attention:`);
      for (const c of critical) {
        console.log(
          `  - ${c.canonical} (importance: ${c.importance}, strength: ${c.currentStrength.toFixed(3)})`
        );
      }
    }

    await closePool();
  } catch (error) {
    console.error("\nDecay scan failed:");
    console.error((error as Error).message);
    await closePool().catch(() => {});
    process.exit(1);
  }
}

main();