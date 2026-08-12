import { Pool } from "pg";
import { readFileSync } from "fs";
import { join } from "path";
import config from "../config";

interface StatementResult {
  statement: string;
  status: "executed" | "skipped" | "failed";
  error?: string;
  durationMs: number;
}

interface InitResult {
  totalStatements: number;
  executed: number;
  skipped: number;
  failed: number;
  results: StatementResult[];
  durationMs: number;
}

async function executeSchema(pool: Pool): Promise<InitResult> {
  const schemaPath = join(__dirname, "init-db.sql");

  let schema: string;
  try {
    schema = readFileSync(schemaPath, "utf-8");
  } catch (error) {
    const err = error as Error;
    console.error(`Failed to read schema file: ${schemaPath}`);
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(`Found ${statements.length} schema statements`);
  console.log("Connecting to database...");

  const start = Date.now();
  const results: StatementResult[] = [];
  let executed = 0;
  let skipped = 0;
  let failed = 0;

  const client = await pool.connect();

  try {
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 80).replace(/\s+/g, " ");
      const stmtStart = Date.now();

      try {
        await client.query(statement);
        const durationMs = Date.now() - stmtStart;

        results.push({
          statement: preview,
          status: "executed",
          durationMs,
        });

        executed++;
        console.log(`  [${i + 1}/${statements.length}] Executed (${durationMs}ms): ${preview}...`);
      } catch (error) {
        const err = error as Error;
        const durationMs = Date.now() - stmtStart;

        if (
          err.message.includes("already exists") ||
          err.message.includes("duplicate")
        ) {
          results.push({
            statement: preview,
            status: "skipped",
            durationMs,
          });

          skipped++;
          console.log(`  [${i + 1}/${statements.length}] Skipped (exists): ${preview}...`);
        } else {
          results.push({
            statement: preview,
            status: "failed",
            error: err.message,
            durationMs,
          });

          failed++;
          console.error(`  [${i + 1}/${statements.length}] FAILED: ${preview}...`);
          console.error(`    Error: ${err.message}`);
        }
      }
    }
  } finally {
    client.release();
  }

  const durationMs = Date.now() - start;

  return {
    totalStatements: statements.length,
    executed,
    skipped,
    failed,
    results,
    durationMs,
  };
}

async function verifySchema(pool: Pool): Promise<void> {
  console.log("\nVerifying schema...");

  const expectedTables = [
    "buckets",
    "bucket_items",
    "embeddings",
    "relationships",
    "messages",
    "raw_chunks",
    "sessions",
    "users",
    "documents",
    "reminders",
  ];

  const client = await pool.connect();

  try {
    for (const table of expectedTables) {
      try {
        const result = await client.query(
          "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists",
          [table]
        );

        const exists = result.rows[0]?.exists ?? false;

        if (exists) {
          const countResult = await client.query(`SELECT COUNT(*)::int AS count FROM ${table}`);
          const count = countResult.rows[0]?.count ?? 0;
          console.log(`  ✓ ${table} (${count} rows)`);
        } else {
          console.error(`  ✗ ${table} (MISSING)`);
        }
      } catch (error) {
        console.error(`  ✗ ${table} (ERROR: ${(error as Error).message})`);
      }
    }
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  console.log("ContextOS Database Initialization");
  console.log("=================================\n");

  console.log(`Environment: ${config.server.nodeEnv}`);
  console.log(`Database: ${config.cockroach.connectionString.replace(/:[^:@]+@/, ":****@")}`);

  const pool = new Pool({
    connectionString: config.cockroach.connectionString,
    max: 5,
    connectionTimeoutMillis: 10000,
    statement_timeout: 30000,
  });

  try {
    console.log("\nTesting connection...");
    console.log("\nTesting connection...");
    await pool.query("SELECT 1");
    console.log("Connection successful\n");
    console.log("Connection successful\n");

    console.log("Applying schema...\n");
    const result = await executeSchema(pool);

    console.log("\n=================================");
    console.log("Results:");
    console.log(`  Total statements: ${result.totalStatements}`);
    console.log(`  Executed: ${result.executed}`);
    console.log(`  Skipped: ${result.skipped}`);
    console.log(`  Failed: ${result.failed}`);
    console.log(`  Duration: ${result.durationMs}ms`);

    if (result.failed > 0) {
      console.error("\nFailed statements:");
      for (const r of result.results.filter((r) => r.status === "failed")) {
        console.error(`  - ${r.statement}`);
        console.error(`    Error: ${r.error}`);
      }
    }

    await verifySchema(pool);

    if (result.failed > 0) {
      console.error("\nDatabase initialization completed with errors.");
      process.exit(1);
    }

    console.log("\nDatabase initialization complete.");
  } catch (error) {
    console.error("\nDatabase initialization failed:");
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();