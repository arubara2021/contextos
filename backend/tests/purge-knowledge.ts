import { initPool, closePool, query } from "../src/database";

const TABLES = ["embeddings", "bucket_items", "relationships", "buckets", "documents"];

async function main() {
  initPool();
  for (const table of TABLES) {
    try {
      const result: any = await query(`DELETE FROM ${table}`);
      console.log(`cleared ${table}: ${result?.rowCount ?? "ok"} rows`);
    } catch (err) {
      console.error(`failed to clear ${table}: ${(err as Error).message}`);
    }
  }
  await closePool();
  console.log("Done. Knowledge graph is now empty (real-data only on next ingest).");
}

main().catch(async (err) => {
  console.error("FATAL:", err.message);
  await closePool().catch(() => {});
  process.exit(1);
});