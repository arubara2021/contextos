import "dotenv/config";
import { Pool } from "pg";

async function wipeData() {
  console.log("🔌 Connecting to CockroachDB (bypassing all timeouts)...");

  // Create a dedicated pool with ZERO timeouts to prevent client/server aborts
  const pool = new Pool({
    connectionString: process.env.COCKROACH_CONNECTION_STRING,
    max: 5,
    statement_timeout: 0, // Disables CockroachDB server-side timeout
    query_timeout: 0,     // Disables Node.js pg client-side timeout
  });

  console.log("🧹 Wiping all data (keeping schema intact)...");

  const tables = [
    "processing_jobs",
    "document_links",
    "contradictions",
    "reminders",
    "raw_chunks",
    "messages",
    "embeddings",
    "bucket_items",
    "relationships",
    "sessions",
    "buckets",
    "documents",
    "users"
  ];

  try {
    for (const table of tables) {
      console.log(`  - Truncating ${table}...`);
      try {
        await pool.query(`TRUNCATE TABLE ${table} CASCADE;`);
      } catch (truncErr: any) {
        // If TRUNCATE gets stuck in a CockroachDB distributed lock, fall back to DELETE
        if (truncErr.message.includes("timeout") || truncErr.message.includes("cancel") || truncErr.message.includes("read timeout")) {
          console.log(`    ⚠️ TRUNCATE timed out, falling back to DELETE FROM ${table}...`);
          await pool.query(`DELETE FROM ${table};`);
        } else {
          throw truncErr;
        }
      }
    }
    console.log("✅ SUCCESS: All data has been completely wiped! The database is clean.");
  } catch (error) {
    console.error("❌ FAILED to wipe data:", (error as Error).message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

wipeData();