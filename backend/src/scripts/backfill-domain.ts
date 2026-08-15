import { initPool, closePool, query, queryMany } from "../database";
import { detectDomainFromContent } from "../ingestion/pipeline";

async function main() {
  initPool();
  await query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS domain TEXT`).catch(() => { });
  const docs = await queryMany<{
    document_id: string;
    filename: string;
    content: string | null;
  }>(
    `SELECT document_id, filename, content FROM documents WHERE domain IS NULL OR domain = ''`
  );
  console.log("documents to backfill:", docs.length);
  for (const d of docs) {
    const domain = detectDomainFromContent(d.content ?? "", d.filename);
    await query(`UPDATE documents SET domain = $1 WHERE document_id = $2::uuid`, [
      domain,
      d.document_id,
    ]);
    console.log("backfilled:", d.filename, "->", domain);
  }
  await closePool().catch(() => { });
  process.exit(0);
}

main().catch((error) => {
  console.error("backfill failed:", (error as Error).message);
  process.exit(1);
});