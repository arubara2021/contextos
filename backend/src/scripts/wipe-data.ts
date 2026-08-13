import "dotenv/config";
import { initPool, getPool, closePool } from "../database";

async function wipeData() {
  console.log("🔌 Connecting to CockroachDB...");
  initPool();
  const pool = getPool();

  console.log("🧹 Wiping all data (keeping schema intact)...");

  // The order doesn't strictly matter with CASCADE, but listing them all ensures everything is caught
  const tables = [
    "processing_jobs",
    "document_links",
    "reminders",
    "contradictions",
    "raw_chunks",
    "messages",
    "sessions",
    "embeddings",
    "relationships",
    "bucket_items",
    "buckets",
    "documents",
    "users"
  ];

  try {
    await pool.query(`TRUNCATE TABLE ${tables.join(", ")} CASCADE;`);
    console.log("✅ SUCCESS: All data has been completely wiped! The database is clean.");
  } catch (error) {
    console.error("❌ FAILED to wipe data:", (error as Error).message);
  } finally {
    await closePool();
    process.exit(0);
  }
}

wipeData();