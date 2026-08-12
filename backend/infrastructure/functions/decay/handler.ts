import { Pool } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.COCKROACH_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error("COCKROACH_CONNECTION_STRING not set");
    }
    pool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

const STRONG_THRESHOLD = Number(process.env.STRONG_THRESHOLD) || 0.7;
const FADING_THRESHOLD = Number(process.env.FADING_THRESHOLD) || 0.4;
const CRITICAL_THRESHOLD = Number(process.env.CRITICAL_THRESHOLD) || 0.4;
const FORGOTTEN_THRESHOLD = Number(process.env.FORGOTTEN_THRESHOLD) || 0.1;
const DEFAULT_DECAY_RATE = Number(process.env.DEFAULT_DECAY_RATE) || 0.15;
const HIGH_IMPORTANCE_DECAY_RATE = 0.1;
const LOW_IMPORTANCE_DECAY_RATE = 0.2;

interface BucketRow {
  bucket_id: string;
  canonical: string;
  strength: number;
  decay_rate: number;
  importance: number;
  last_accessed: Date;
}

interface ThresholdCrossing {
  bucketId: string;
  canonical: string;
  previousStrength: number;
  currentStrength: number;
  crossedThreshold: string | null;
  direction: "up" | "down";
  importance: number;
  lastAccessed: string;
}

interface DecayScanResult {
  scanned: number;
  updated: number;
  crossings: ThresholdCrossing[];
  categories: {
    strong: number;
    fading: number;
    critical: number;
    forgotten: number;
  };
  averageStrength: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

function getDecayRate(importance: number): number {
  if (importance >= 8) return HIGH_IMPORTANCE_DECAY_RATE;
  if (importance >= 5) return DEFAULT_DECAY_RATE;
  return LOW_IMPORTANCE_DECAY_RATE;
}

function computeStrength(
  initialStrength: number,
  decayRate: number,
  daysSinceAccess: number
): number {
  if (daysSinceAccess <= 0) return initialStrength;
  const decayed = initialStrength * Math.pow(1 - decayRate, daysSinceAccess);
  return Math.max(0, Math.min(1, Math.round(decayed * 10000) / 10000));
}

function categorize(strength: number): string {
  if (strength >= STRONG_THRESHOLD) return "strong";
  if (strength >= FADING_THRESHOLD) return "fading";
  if (strength >= FORGOTTEN_THRESHOLD) return "critical";
  return "forgotten";
}

async function runDecayScan(): Promise<DecayScanResult> {
  const start = Date.now();
  const startedAt = new Date().toISOString();
  const db = getPool();

  const rows = await db.query<BucketRow>("SELECT * FROM buckets");

  const crossings: ThresholdCrossing[] = [];
  let updated = 0;
  const categories = { strong: 0, fading: 0, critical: 0, forgotten: 0 };
  let totalStrength = 0;

  for (const row of rows.rows) {
    const previousStrength = Number(row.strength);
    const decayRate = Number(row.decay_rate) || getDecayRate(Number(row.importance));
    const lastAccessed = new Date(row.last_accessed);
    const now = Date.now();
    const daysSinceAccess = (now - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);

    const currentStrength = computeStrength(previousStrength, decayRate, daysSinceAccess);
    totalStrength += currentStrength;

    const currentCategory = categorize(currentStrength);
    categories[currentCategory as keyof typeof categories]++;

    if (Math.abs(currentStrength - previousStrength) < 0.001) {
      continue;
    }

    try {
      await db.query(
        "UPDATE buckets SET strength = $1 WHERE bucket_id = $2",
        [currentStrength, row.bucket_id]
      );
      updated++;
    } catch (updateError) {
      console.error("Failed to update bucket strength:", {
        bucketId: row.bucket_id,
        error: (updateError as Error).message,
      });
      continue;
    }

    const previousCategory = categorize(previousStrength);
    if (previousCategory !== currentCategory) {
      crossings.push({
        bucketId: row.bucket_id,
        canonical: row.canonical,
        previousStrength,
        currentStrength,
        crossedThreshold: currentCategory,
        direction: currentStrength < previousStrength ? "down" : "up",
        importance: Number(row.importance),
        lastAccessed: lastAccessed.toISOString(),
      });
    }
  }

  const durationMs = Date.now() - start;
  const completedAt = new Date().toISOString();
  const averageStrength = rows.rows.length > 0
    ? Math.round((totalStrength / rows.rows.length) * 10000) / 10000
    : 0;

  const criticalCrossings = crossings.filter(
    (c) => c.crossedThreshold === "critical" || c.crossedThreshold === "forgotten"
  );

  if (criticalCrossings.length > 0) {
    console.warn("Critical threshold crossings detected", {
      count: criticalCrossings.length,
      memories: criticalCrossings.map((c) => ({
        bucketId: c.bucketId,
        canonical: c.canonical,
        strength: c.currentStrength,
        category: c.crossedThreshold,
      })),
    });
  }

  console.log("Decay scan complete", {
    scanned: rows.rows.length,
    updated,
    crossings: crossings.length,
    averageStrength,
    durationMs,
  });

  return {
    scanned: rows.rows.length,
    updated,
    crossings,
    categories,
    averageStrength,
    durationMs,
    startedAt,
    completedAt,
  };
}

async function runDecayScanWithRetry(
  maxRetries: number = 2,
  retryDelayMs: number = 5000
): Promise<DecayScanResult> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await runDecayScan();
    } catch (error) {
      lastError = error as Error;

      if (attempt < maxRetries) {
        const delay = retryDelayMs * Math.pow(2, attempt);
        console.warn("Decay scan failed, retrying", {
          attempt: attempt + 1,
          maxRetries,
          delayMs: delay,
          error: lastError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError ?? new Error("Decay scan failed after retries");
}

interface ScheduledEvent {
  source: string;
  "detail-type": string;
  detail: Record<string, unknown>;
  time: string;
  region: string;
  resources: string[];
}

interface LambdaEvent {
  httpMethod?: string;
  body?: string | null;
  source?: string;
  "detail-type"?: string;
  requestContext?: {
    authorizer?: {
      userId?: string;
    };
  };
}

interface LambdaResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function buildResponse(statusCode: number, body: unknown): LambdaResponse {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    },
    body: JSON.stringify(body),
  };
}

export async function handler(event: LambdaEvent): Promise<LambdaResponse> {
  const isScheduledEvent = event.source === "aws.events" || !event.httpMethod;

  console.log("Decay scan handler invoked", {
    trigger: isScheduledEvent ? "scheduled" : "api",
    source: event.source,
    method: event.httpMethod,
  });

  if (event.httpMethod === "OPTIONS") {
    return buildResponse(200, { message: "OK" });
  }

  if (event.httpMethod && event.httpMethod !== "POST" && event.httpMethod !== "GET") {
    return buildResponse(405, { error: "Method not allowed" });
  }

  try {
    const result = await runDecayScanWithRetry();

    const response = {
      message: "Decay scan complete",
      scanned: result.scanned,
      updated: result.updated,
      crossingsCount: result.crossings.length,
      crossings: result.crossings.slice(0, 50),
      categories: result.categories,
      averageStrength: result.averageStrength,
      durationMs: result.durationMs,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
    };

    if (isScheduledEvent) {
      console.log("Scheduled decay scan completed", {
        scanned: result.scanned,
        updated: result.updated,
        crossings: result.crossings.length,
        durationMs: result.durationMs,
      });
    }

    return buildResponse(200, response);
  } catch (error) {
    console.error("Decay scan handler error:", error);
    return buildResponse(500, {
      error: "Decay scan failed",
      message: (error as Error).message,
    });
  }
}