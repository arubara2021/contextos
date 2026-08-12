import { Pool } from "pg";
import { writeFileSync } from "fs";
import { join } from "path";
import config from "../config";

interface ExportData {
  exportedAt: string;
  version: string;
  counts: {
    buckets: number;
    relationships: number;
    messages: number;
    sessions: number;
    documents: number;
    users: number;
  };
  buckets: Array<{
    bucketId: string;
    canonical: string;
    strength: number;
    importance: number;
    conceptType: string;
    lastAccessed: string;
    accessCount: number;
    decayRate: number;
    createdAt: string;
    items: Array<{
      label: string;
      definition: string | null;
      source: string | null;
    }>;
  }>;
  relationships: Array<{
    relationshipId: string;
    sourceBucket: string;
    targetBucket: string;
    relationType: string;
    confidence: number;
    createdAt: string;
  }>;
  sessions: Array<{
    sessionId: string;
    userId: string;
    title: string;
    messageCount: number;
    createdAt: string;
    messages: Array<{
      role: string;
      content: string;
      timestamp: string;
    }>;
  }>;
}

async function exportData(pool: Pool): Promise<ExportData> {
  const bucketsResult = await pool.query(
    "SELECT * FROM buckets ORDER BY created_at"
  );

  const itemsResult = await pool.query(
    "SELECT * FROM bucket_items ORDER BY bucket_id, timestamp"
  );

  const relationshipsResult = await pool.query(
    "SELECT * FROM relationships ORDER BY created_at"
  );

  const sessionsResult = await pool.query(
    "SELECT * FROM sessions ORDER BY created_at"
  );

  const messagesResult = await pool.query(
    "SELECT * FROM messages ORDER BY session_id, timestamp"
  );

  const documentsResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM documents"
  );

  const usersResult = await pool.query(
    "SELECT COUNT(*)::int AS count FROM users"
  );

  const itemsByBucket = new Map<string, Array<{
    label: string;
    definition: string | null;
    source: string | null;
  }>>();

  for (const item of itemsResult.rows) {
    const bucketId = item.bucket_id;
    if (!itemsByBucket.has(bucketId)) {
      itemsByBucket.set(bucketId, []);
    }
    itemsByBucket.get(bucketId)!.push({
      label: item.label,
      definition: item.definition,
      source: item.source,
    });
  }

  const messagesBySession = new Map<string, Array<{
    role: string;
    content: string;
    timestamp: string;
  }>>();

  for (const msg of messagesResult.rows) {
    const sessionId = msg.session_id;
    if (!messagesBySession.has(sessionId)) {
      messagesBySession.set(sessionId, []);
    }
    messagesBySession.get(sessionId)!.push({
      role: msg.role,
      content: msg.content,
      timestamp: new Date(msg.timestamp).toISOString(),
    });
  }

  const buckets = bucketsResult.rows.map((row) => ({
    bucketId: row.bucket_id,
    canonical: row.canonical,
    strength: Number(row.strength),
    importance: Number(row.importance),
    conceptType: row.concept_type,
    lastAccessed: new Date(row.last_accessed).toISOString(),
    accessCount: Number(row.access_count),
    decayRate: Number(row.decay_rate),
    createdAt: new Date(row.created_at).toISOString(),
    items: itemsByBucket.get(row.bucket_id) ?? [],
  }));

  const relationships = relationshipsResult.rows.map((row) => ({
    relationshipId: row.relationship_id,
    sourceBucket: row.source_bucket,
    targetBucket: row.target_bucket,
    relationType: row.relation_type,
    confidence: Number(row.confidence),
    createdAt: new Date(row.created_at).toISOString(),
  }));

  const sessions = sessionsResult.rows.map((row) => ({
    sessionId: row.session_id,
    userId: row.user_id,
    title: row.title,
    messageCount: Number(row.message_count),
    createdAt: new Date(row.created_at).toISOString(),
    messages: messagesBySession.get(row.session_id) ?? [],
  }));

  return {
    exportedAt: new Date().toISOString(),
    version: "1.0.0",
    counts: {
      buckets: buckets.length,
      relationships: relationships.length,
      messages: messagesResult.rows.length,
      sessions: sessions.length,
      documents: documentsResult.rows[0]?.count ?? 0,
      users: usersResult.rows[0]?.count ?? 0,
    },
    buckets,
    relationships,
    sessions,
  };
}

async function main(): Promise<void> {
  const start = Date.now();

  console.log("ContextOS Memory Exporter");
  console.log("=========================\n");

  const args = process.argv.slice(2);
  const outputPath = args[0] ?? join(process.cwd(), `export-${Date.now()}.json`);

  const pool = new Pool({
    connectionString: config.cockroach.connectionString,
    max: 5,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log("Testing connection...");
    await pool.query("SELECT 1");
    console.log("Connection successful\n");

    console.log("Exporting data...");
    const data = await exportData(pool);

    console.log("\nExport summary:");
    console.log(`  Buckets: ${data.counts.buckets}`);
    console.log(`  Relationships: ${data.counts.relationships}`);
    console.log(`  Messages: ${data.counts.messages}`);
    console.log(`  Sessions: ${data.counts.sessions}`);
    console.log(`  Documents: ${data.counts.documents}`);
    console.log(`  Users: ${data.counts.users}`);

    const json = JSON.stringify(data, null, 2);
    const sizeBytes = Buffer.byteLength(json, "utf-8");
    const sizeMB = Math.round((sizeBytes / (1024 * 1024)) * 100) / 100;

    writeFileSync(outputPath, json, "utf-8");

    const durationMs = Date.now() - start;

    console.log(`\nExport written to: ${outputPath}`);
    console.log(`  Size: ${sizeMB} MB (${sizeBytes} bytes)`);
    console.log(`  Duration: ${durationMs}ms`);
    console.log("\nExport complete.");
  } catch (error) {
    console.error("\nExport failed:");
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();