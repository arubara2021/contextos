import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import config from "../config";

const DIM = 1024;
const DAY_MS = 86_400_000;

interface SeedConcept {
  canonical: string;
  type: string;
  importance: number;
  definition: string;
  strength: number;
  daysAgo: number;
}

type Edge = [string, string, string, number];

const CONCEPTS: SeedConcept[] = [
  { canonical: "Two-Tower Recommendation Model", type: "entity", importance: 8, strength: 0.92, daysAgo: 0, definition: "Retrieval architecture that encodes users and items with separate towers, enabling fast candidate generation via nearest-neighbor search over item embeddings." },
  { canonical: "FAISS ANN Search", type: "code", importance: 8, strength: 0.88, daysAgo: 1, definition: "Approximate nearest-neighbor index over product embeddings that returns top candidates in sub-millisecond time instead of scanning every item." },
  { canonical: "Feature Store (Feast)", type: "entity", importance: 7, strength: 0.74, daysAgo: 2, definition: "Centralized layer that serves consistent features to both training and inference, preventing train/serve skew across the recommendation pipeline." },
  { canonical: "Kafka Feature Ingestion", type: "decision", importance: 7, strength: 0.66, daysAgo: 3, definition: "Streaming backbone that publishes real-time user and item events so online features stay fresh between batch recomputations." },
  { canonical: "Batch vs Stream Hybrid", type: "decision", importance: 8, strength: 0.81, daysAgo: 0, definition: "Architecture decision to combine nightly batch training with a streaming feature layer, balancing model quality against freshness at 10M-user scale." },
  { canonical: "Spark Batch Training", type: "entity", importance: 6, strength: 0.34, daysAgo: 7, definition: "Distributed batch jobs that retrain the two-tower model over the full interaction history and rebuild the product embedding index nightly." },
  { canonical: "Triton Inference Server", type: "entity", importance: 7, strength: 0.78, daysAgo: 1, definition: "Model-serving runtime chosen to host the user tower behind a load balancer and hit the sub-50ms latency budget under load." },
  { canonical: "Sub-50ms Serving Target", type: "problem", importance: 9, strength: 0.95, daysAgo: 0, definition: "Hard latency requirement for the recommendation API that drove every serving-layer choice, from precomputed embeddings to in-memory caches." },
  { canonical: "Product Embedding Cache", type: "decision", importance: 7, strength: 0.71, daysAgo: 2, definition: "Decision to precompute all item embeddings nightly and serve them from an index, avoiding full-model inference at request time." },
  { canonical: "Redis Embedding Cache", type: "decision", importance: 6, strength: 0.58, daysAgo: 4, definition: "One-hour TTL cache of computed user embeddings that removes repeat computation for returning visitors." },
  { canonical: "gRPC Internal Comms", type: "decision", importance: 5, strength: 0.45, daysAgo: 5, definition: "Binary RPC protocol adopted between serving services to cut serialization overhead versus REST on the hot path." },
  { canonical: "JWT Stateless Auth", type: "decision", importance: 8, strength: 0.9, daysAgo: 0, definition: "Stateless token strategy chosen for the API so servers scale horizontally without shared session state, paired with short-lived access tokens." },
  { canonical: "Refresh Token Rotation", type: "decision", importance: 7, strength: 0.83, daysAgo: 1, definition: "Pattern of issuing a new refresh token on each use, limiting the blast radius of a stolen token while keeping access tokens short-lived." },
  { canonical: "Bcrypt Cost 12", type: "fact", importance: 5, strength: 0.62, daysAgo: 3, definition: "Password-hashing configuration with a cost factor of 12, balancing brute-force resistance against login latency." },
  { canonical: "Rate Limiting Strategy", type: "decision", importance: 7, strength: 0.77, daysAgo: 2, definition: "Sliding-window limits at the gateway — 60 req/min authenticated, 20 anonymous — to protect the API from abuse and load spikes." },
  { canonical: "Exponential Backoff Lockout", type: "decision", importance: 6, strength: 0.5, daysAgo: 6, definition: "Escalating account lockout after repeated failed logins (5/15/30 minutes) that throttles credential-stuffing attacks." },
  { canonical: "Composite & Partial Indexes", type: "code", importance: 7, strength: 0.69, daysAgo: 3, definition: "Indexing strategy that matches WHERE-clause patterns and frequently filtered subsets to keep queries fast as the 50GB dataset grows." },
  { canonical: "Table Partitioning by Date", type: "decision", importance: 7, strength: 0.41, daysAgo: 8, definition: "Range partitioning of time-series tables that speeds date-bounded queries and makes old-data archival a metadata operation." },
  { canonical: "N+1 Query Pattern", type: "problem", importance: 9, strength: 0.86, daysAgo: 1, definition: "Performance anti-pattern where a list query fires one extra query per row, identified as the top ORM-layer bottleneck." },
  { canonical: "DataLoader Batching", type: "code", importance: 7, strength: 0.73, daysAgo: 2, definition: "Per-request batching and deduplication of database calls, the GraphQL-side fix that collapses N+1 fan-out into a single query." },
  { canonical: "Eager Loading", type: "code", importance: 6, strength: 0.64, daysAgo: 4, definition: "ORM technique (joinedload / include / relations) that fetches associations up front so a single endpoint stays within a handful of queries." },
  { canonical: "Session-Based Auth (Rejected)", type: "decision", importance: 3, strength: 0.18, daysAgo: 22, definition: "Earlier session-store approach that was rejected because it forced shared state across servers and blocked horizontal scaling." },
];

const EDGES: Edge[] = [
  ["Two-Tower Recommendation Model", "FAISS ANN Search", "requires", 0.8],
  ["Two-Tower Recommendation Model", "Feature Store (Feast)", "requires", 0.75],
  ["FAISS ANN Search", "Product Embedding Cache", "part_of", 0.7],
  ["Feature Store (Feast)", "Kafka Feature Ingestion", "requires", 0.7],
  ["Kafka Feature Ingestion", "Batch vs Stream Hybrid", "part_of", 0.65],
  ["Spark Batch Training", "Batch vs Stream Hybrid", "evolves_into", 0.6],
  ["Sub-50ms Serving Target", "Triton Inference Server", "requires", 0.8],
  ["Sub-50ms Serving Target", "Product Embedding Cache", "requires", 0.75],
  ["Sub-50ms Serving Target", "Redis Embedding Cache", "requires", 0.7],
  ["Triton Inference Server", "gRPC Internal Comms", "related_to", 0.55],
  ["JWT Stateless Auth", "Refresh Token Rotation", "requires", 0.8],
  ["JWT Stateless Auth", "Bcrypt Cost 12", "related_to", 0.5],
  ["JWT Stateless Auth", "Session-Based Auth (Rejected)", "replaces", 0.8],
  ["Rate Limiting Strategy", "Exponential Backoff Lockout", "causes", 0.6],
  ["Rate Limiting Strategy", "Bcrypt Cost 12", "related_to", 0.45],
  ["Composite & Partial Indexes", "Table Partitioning by Date", "related_to", 0.6],
  ["N+1 Query Pattern", "DataLoader Batching", "related_to", 0.75],
  ["N+1 Query Pattern", "Eager Loading", "related_to", 0.7],
  ["DataLoader Batching", "Eager Loading", "related_to", 0.6],
  ["Product Embedding Cache", "Redis Embedding Cache", "related_to", 0.5],
  ["Two-Tower Recommendation Model", "Sub-50ms Serving Target", "related_to", 0.6],
];

function hashStr(value: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rawVec(seed: number): number[] {
  const rand = mulberry32(seed);
  const v: number[] = [];
  for (let i = 0; i < DIM; i++) v.push(rand() * 2 - 1);
  return v;
}

function normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum) || 1;
  return v.map((x) => x / len);
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function decayRateFor(importance: number): number {
  if (importance >= 8) return 0.1;
  if (importance >= 5) return 0.15;
  return 0.2;
}

function vecToString(v: number[]): string {
  return "[" + v.map((n) => n.toFixed(6)).join(",") + "]";
}

function buildEmbeddings(): Map<string, number[]> {
  const base = new Map<string, number[]>();
  for (const concept of CONCEPTS) {
    base.set(concept.canonical, rawVec(hashStr(concept.canonical)));
  }
  const adjacency = new Map<string, Set<string>>();
  for (const [source, target] of EDGES) {
    if (!adjacency.has(source)) adjacency.set(source, new Set());
    if (!adjacency.has(target)) adjacency.set(target, new Set());
    adjacency.get(source)!.add(target);
    adjacency.get(target)!.add(source);
  }
  const blended = new Map<string, number[]>();
  for (const concept of CONCEPTS) {
    const own = base.get(concept.canonical)!;
    const neighbors = adjacency.get(concept.canonical);
    const acc = own.map((x) => x * 0.6);
    let count = 0;
    if (neighbors) {
      for (const neighbor of neighbors) {
        if (base.has(neighbor)) count++;
      }
    }
    if (count > 0 && neighbors) {
      for (const neighbor of neighbors) {
        const nb = base.get(neighbor);
        if (!nb) continue;
        for (let i = 0; i < DIM; i++) acc[i] += (0.4 * nb[i]) / count;
      }
    }
    blended.set(concept.canonical, normalize(acc));
  }
  return blended;
}

async function main(): Promise<void> {
  const start = Date.now();
  console.log("ContextOS Graph Seeder");
  console.log("======================\n");

  const pool = new Pool({
    connectionString: config.cockroach.connectionString,
    max: 5,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log("Testing connection...");
    await pool.query("SELECT 1");
    console.log("Connection successful\n");

    const embeddings = buildEmbeddings();
    let bucketsWritten = 0;
    let itemsWritten = 0;
    let embeddingsWritten = 0;

    for (const concept of CONCEPTS) {
      const normalized = normalizeKey(concept.canonical);
      const lastAccessed = new Date(Date.now() - concept.daysAgo * DAY_MS).toISOString();
      const accessCount = Math.round(concept.strength * 30) + 2;
      const rate = decayRateFor(concept.importance);
      const vector = vecToString(embeddings.get(concept.canonical)!);

      const upsert = await pool.query<{ bucket_id: string }>(
        `INSERT INTO buckets
           (bucket_id, canonical, normalized, strength, importance, concept_type, last_accessed, access_count, decay_rate)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (normalized) DO UPDATE SET
           canonical = EXCLUDED.canonical,
           strength = EXCLUDED.strength,
           importance = EXCLUDED.importance,
           concept_type = EXCLUDED.concept_type,
           last_accessed = EXCLUDED.last_accessed,
           access_count = EXCLUDED.access_count,
           decay_rate = EXCLUDED.decay_rate
         RETURNING bucket_id`,
        [
          uuidv4(),
          concept.canonical,
          normalized,
          concept.strength,
          concept.importance,
          concept.type,
          lastAccessed,
          accessCount,
          rate,
        ]
      );

      const bucketId = upsert.rows[0]?.bucket_id;
      if (!bucketId) throw new Error(`No bucket_id returned for ${concept.canonical}`);

      await pool.query("DELETE FROM bucket_items WHERE bucket_id = $1", [bucketId]);
      await pool.query(
        `INSERT INTO bucket_items (item_id, bucket_id, label, definition, source, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [uuidv4(), bucketId, concept.canonical, concept.definition, "seed:graph", new Date().toISOString()]
      );
      itemsWritten++;

      await pool.query(
        `INSERT INTO embeddings (embedding_id, bucket_id, vector)
         VALUES ($1, $2, $3::vector)
         ON CONFLICT (bucket_id) DO UPDATE SET vector = EXCLUDED.vector`,
        [uuidv4(), bucketId, vector]
      );
      embeddingsWritten++;
      bucketsWritten++;
      console.log(`  bucket  ${concept.type.padEnd(8)} ${Math.round(concept.strength * 100)}%  ${concept.canonical}`);
    }

    let edgesWritten = 0;
    for (const [source, target, relationType, confidence] of EDGES) {
      await pool.query(
        `INSERT INTO relationships
           (relationship_id, source_bucket, target_bucket, relation_type, confidence, source_text)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (source_bucket, target_bucket, relation_type)
         DO UPDATE SET confidence = EXCLUDED.confidence, source_text = EXCLUDED.source_text`,
        [uuidv4(), source, target, relationType, confidence, "seed:graph"]
      );
      edgesWritten++;
    }

    const durationMs = Date.now() - start;
    console.log("\n======================");
    console.log("Graph seed complete:");
    console.log(`  Buckets:    ${bucketsWritten}`);
    console.log(`  Items:      ${itemsWritten}`);
    console.log(`  Embeddings: ${embeddingsWritten} (${DIM}-d)`);
    console.log(`  Edges:      ${edgesWritten}`);
    console.log(`  Duration:   ${durationMs}ms`);
    console.log("\nThe cortex now has a live, searchable memory graph.");
  } catch (error) {
    console.error("\nGraph seed failed:");
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();