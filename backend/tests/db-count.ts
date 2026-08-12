import { initPool, closePool, queryOne } from "../src/database";

async function main(): Promise<void> {
  initPool();

  const tables = [
    "users",
    "sessions",
    "messages",
    "documents",
    "buckets",
    "bucket_items",
    "embeddings",
    "relationships",
    "processing_jobs",
    "reminders",
    "contradictions",
  ];

  for (const table of tables) {
    const row = await queryOne<{ count: number }>(
      `SELECT count(*)::int AS count FROM ${table}`
    );

    console.log(`${table}: ${row?.count ?? 0}`);
  }

  await closePool();
}

main();