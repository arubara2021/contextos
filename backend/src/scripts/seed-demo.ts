import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import config from "../config";
import { hashPassword } from "../auth/password";

interface SeedResult {
  userId: string;
  sessionIds: string[];
  messageCount: number;
  durationMs: number;
}

const DEMO_USER = {
  email: "demo@contextos.local",
  password: "Demo1234!",
  displayName: "Demo User",
};

const DEMO_CONVERSATIONS: Array<{
  title: string;
  messages: Array<{ role: string; content: string }>;
}> = [
  {
    title: "ML Pipeline Architecture",
    messages: [
      {
        role: "user",
        content:
          "I need to design a machine learning pipeline for our recommendation system. We have about 10 million users and 500k products. The pipeline needs to handle real-time feature updates and batch training.",
      },
      {
        role: "assistant",
        content:
          "For a system of that scale, I'd recommend a hybrid architecture with both batch and stream processing layers. Use Apache Kafka for real-time feature ingestion, Apache Spark for batch training jobs, and a feature store like Feast to serve features consistently between training and inference. Consider using a two-tower model architecture for the recommendation engine - one tower for user features and one for item features, with approximate nearest neighbor search using FAISS for serving.",
      },
      {
        role: "user",
        content:
          "That sounds good. What about the model serving layer? We need sub-50ms latency for the recommendation API.",
      },
      {
        role: "assistant",
        content:
          "For sub-50ms latency, I'd suggest deploying the model using NVIDIA Triton Inference Server or TensorFlow Serving behind a load balancer. Pre-compute embeddings for all products nightly and store them in a FAISS index. At serving time, compute the user embedding in real-time using the user feature vector, then do ANN search against the product index. This avoids running the full model at request time. Use Redis to cache user embeddings with a TTL of about 1 hour to reduce computation for repeat visitors. Consider using gRPC instead of REST for internal service communication to reduce serialization overhead.",
      },
      {
        role: "user",
        content:
          "What monitoring should we set up for the ML pipeline?",
      },
      {
        role: "assistant",
        content:
          "Set up monitoring at three levels. First, infrastructure monitoring using Prometheus and Grafana for CPU, GPU utilization, memory, and network metrics on your training and serving clusters. Second, model performance monitoring - track metrics like click-through rate, conversion rate, and recommendation relevance score. Use A/B testing framework to compare model versions. Third, data quality monitoring - detect feature drift using statistical tests like KS-test on feature distributions, monitor data freshness and completeness, and set up alerts when feature pipelines are delayed. Tools like Evidently AI or WhyLabs can help with data and model drift detection.",
      },
    ],
  },
  {
    title: "Authentication System Design",
    messages: [
      {
        role: "user",
        content:
          "We need to implement authentication for our new API. Should we use JWT tokens or session-based auth?",
      },
      {
        role: "assistant",
        content:
          "For a modern API, JWT tokens are generally the better choice. They're stateless, which means your API servers don't need to share session state - this makes horizontal scaling much easier. JWTs work well with SPAs and mobile apps since they can be stored client-side. Use access tokens with short expiration (15 minutes) paired with refresh tokens (7 days). Store refresh tokens in an HTTP-only secure cookie to prevent XSS attacks. Use bcrypt for password hashing with a cost factor of 12.",
      },
      {
        role: "user",
        content:
          "What about rate limiting and brute force protection?",
      },
      {
        role: "assistant",
        content:
          "Implement rate limiting at multiple levels. At the API gateway level, use a sliding window rate limiter - 60 requests per minute for authenticated users, 20 per minute for unauthenticated endpoints. For login specifically, implement exponential backoff: after 5 failed attempts, lock the account for 5 minutes, then 15 minutes, then 30 minutes. Use Redis to track failed attempts with automatic expiration. Add CAPTCHA after 3 failed attempts. Consider implementing a Web Application Firewall like Cloudflare WAF or AWS WAF for additional protection against automated attacks. Log all failed authentication attempts with IP address and user agent for security auditing.",
      },
    ],
  },
  {
    title: "Database Optimization",
    messages: [
      {
        role: "user",
        content:
          "Our PostgreSQL queries are getting slow as our data grows. We're at about 50GB now. What optimization strategies should we consider?",
      },
      {
        role: "assistant",
        content:
          "Start with query analysis using EXPLAIN ANALYZE to identify the slowest queries. Common fixes include: adding composite indexes that match your WHERE clause patterns, using partial indexes for frequently filtered subsets, rewriting subqueries as JOINs, and using materialized views for expensive aggregations that don't need real-time data. For your 50GB database, consider table partitioning by date range for time-series data - this can dramatically improve query performance and make data archival easier. Also check your PostgreSQL configuration - shared_buffers should be about 25% of RAM, effective_cache_size about 75%, and work_mem depends on your concurrent query load.",
      },
      {
        role: "user",
        content:
          "We also have an N+1 query problem in our ORM layer. How do we fix that?",
      },
      {
        role: "assistant",
        content:
          "N+1 queries are one of the most common performance killers. The fix depends on your ORM, but the pattern is the same: use eager loading. In SQLAlchemy, use joinedload() or subqueryload() for relationships. In Prisma, use the include option. In TypeORM, use relations in find options. For GraphQL, implement DataLoader which batches and deduplicates database calls within a single request. Another approach is to use database views or raw SQL for read-heavy endpoints where the ORM abstraction adds unnecessary overhead. Monitor your query count per request using middleware - if a single endpoint generates more than 5-10 queries, it likely has N+1 issues.",
      },
    ],
  },
];

async function main(): Promise<void> {
  const start = Date.now();

  console.log("ContextOS Demo Data Seeder");
  console.log("==========================\n");

  const pool = new Pool({
    connectionString: config.cockroach.connectionString,
    max: 5,
    connectionTimeoutMillis: 10000,
  });

  try {
    console.log("Testing connection...");
    await pool.query("SELECT 1");
    console.log("Connection successful\n");

    console.log("Creating demo user...");
    const passwordHash = await hashPassword(DEMO_USER.password);
    const userId = uuidv4();

    await pool.query(
      `INSERT INTO users (user_id, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         updated_at = now()
       RETURNING user_id`,
      [userId, DEMO_USER.email, passwordHash, DEMO_USER.displayName]
    );

    const existingUser = await pool.query(
      "SELECT user_id FROM users WHERE email = $1",
      [DEMO_USER.email]
    );
    const actualUserId = existingUser.rows[0]?.user_id ?? userId;

    console.log(`  User ID: ${actualUserId}`);
    console.log(`  Email: ${DEMO_USER.email}`);

    let totalMessages = 0;
    const sessionIds: string[] = [];

    for (const conversation of DEMO_CONVERSATIONS) {
      console.log(`\nCreating conversation: "${conversation.title}"`);

      const sessionId = uuidv4();
      sessionIds.push(sessionId);

      await pool.query(
        `INSERT INTO sessions (session_id, user_id, title, message_count)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, actualUserId, conversation.title, conversation.messages.length]
      );

      for (let i = 0; i < conversation.messages.length; i++) {
        const msg = conversation.messages[i];
        const messageId = uuidv4();
        const timestamp = new Date(Date.now() + i * 60000).toISOString();

        await pool.query(
          `INSERT INTO messages (message_id, session_id, role, content, timestamp)
           VALUES ($1, $2, $3, $4, $5)`,
          [messageId, sessionId, msg.role, msg.content, timestamp]
        );

        totalMessages++;
        console.log(`  [${i + 1}/${conversation.messages.length}] ${msg.role} message stored`);
      }
    }

    const durationMs = Date.now() - start;

    console.log("\n==========================");
    console.log("Seed complete:");
    console.log(`  User: ${actualUserId}`);
    console.log(`  Sessions: ${sessionIds.length}`);
    console.log(`  Messages: ${totalMessages}`);
    console.log(`  Duration: ${durationMs}ms`);
    console.log(`\nLogin credentials:`);
    console.log(`  Email: ${DEMO_USER.email}`);
    console.log(`  Password: ${DEMO_USER.password}`);
  } catch (error) {
    console.error("\nSeed failed:");
    console.error((error as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();