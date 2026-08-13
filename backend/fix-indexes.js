const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    connectionString: process.env.COCKROACH_CONNECTION_STRING,
    max: 1,
    statement_timeout: 0, // 0 = no timeout (CRITICAL for schema changes)
    query_timeout: 0,     // 0 = no timeout
    connectionTimeoutMillis: 30000,
});

const commands = [
    `ALTER TABLE relationships SET (schema_locked = false)`,
    `CREATE INDEX IF NOT EXISTS idx_relationships_source_target_type ON relationships (source_bucket_id, target_bucket_id, relation_type) WHERE source_bucket_id IS NOT NULL AND target_bucket_id IS NOT NULL`,
    `ALTER TABLE relationships SET (schema_locked = true)`,
    `ALTER TABLE buckets SET (schema_locked = false)`,
    `CREATE INDEX IF NOT EXISTS idx_buckets_normalized_lookup ON buckets (normalized) INCLUDE (bucket_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_buckets_user_normalized_lookup ON buckets (user_id, normalized) INCLUDE (bucket_id) WHERE user_id IS NOT NULL`,
    `ALTER TABLE buckets SET (schema_locked = true)`,
];

(async () => {
    try {
        const client = await pool.connect();
        console.log("✅ Connected to CockroachDB\n");
        for (let i = 0; i < commands.length; i++) {
            console.log(`[${i + 1}/${commands.length}] Running...`);
            await client.query(commands[i]);
            console.log(`   ✅ Done\n`);
        }
        client.release();
        await pool.end();
        console.log("🎉 Indexes created successfully.");
    } catch (err) {
        console.error("❌ Failed:", err.message);
        process.exit(1);
    }
})();