import "dotenv/config";
import { initPool, closePool, query } from "../database";

const TABLES = [
  "messages",
  "raw_chunks",
  "bucket_items",
  "embeddings",
  "relationships",
  "document_links",
  "processing_jobs",
  "contradictions",
  "reminders",
  "sessions",
  "documents",
  "buckets",
  "users",
];

async function main() {
  initPool();

  console.log("ContextOS Database Cleaner");
  console.log("==========================\n");

  for (const table of TABLES) {
    try {
      const result: any = await query(`DELETE FROM ${table}`);
      console.log(`  ${table}: ${result?.rowCount ?? 0} rows deleted`);
    } catch (err) {
      console.error(`  ${table}: FAILED — ${(err as Error).message}`);
    }
  }

  await closePool();

  console.log("\n==========================");
  console.log("All tables cleared.");
  console.log("Run seed-demo.ts to restore the demo user.");
}

main().catch(async (err) => {
  console.error("FATAL:", err.message);
  await closePool().catch(() => { });
  process.exit(1);
});