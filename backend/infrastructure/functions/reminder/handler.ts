import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";

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
const FORGOTTEN_THRESHOLD = Number(process.env.FORGOTTEN_THRESHOLD) || 0.1;
const MIN_IMPORTANCE = Number(process.env.MIN_IMPORTANCE) || 5;
const CHECK_INTERVAL_HOURS = Number(process.env.CHECK_INTERVAL_HOURS) || 4;
const MAX_TOPICS_SHOWN = 5;

interface BucketRow {
  bucket_id: string;
  canonical: string;
  strength: number;
  decay_rate: number;
  importance: number;
  last_accessed: Date;
}

interface ReminderMemory {
  bucketId: string;
  canonical: string;
  strength: number;
  importance: number;
  daysSinceAccess: number;
}

interface ReminderRow {
  reminder_id: string;
  user_id: string;
  message: string;
  memories: string | null;
  dismissed: boolean;
  action_taken: string | null;
  created_at: Date;
}

interface UserRow {
  user_id: string;
  email: string;
  display_name: string;
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

function buildReminderMessage(memories: ReminderMemory[]): string {
  const names = memories.slice(0, MAX_TOPICS_SHOWN).map((m) => m.canonical);
  const nameList =
    names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      : names[0];
  const count = memories.length;
  return `You haven't discussed ${nameList} recently. ${count} key memor${count === 1 ? "y is" : "ies are"} fading. Should I keep them active?`;
}

async function scanCriticalMemories(): Promise<ReminderMemory[]> {
  const db = getPool();

  const rows = await db.query<BucketRow>(
    "SELECT * FROM buckets WHERE importance >= $1",
    [MIN_IMPORTANCE]
  );

  const criticalMemories: ReminderMemory[] = [];

  for (const row of rows.rows) {
    const strength = Number(row.strength);
    const decayRate = Number(row.decay_rate);
    const lastAccessed = new Date(row.last_accessed);
    const now = Date.now();
    const daysSinceAccess = (now - lastAccessed.getTime()) / (1000 * 60 * 60 * 24);
    const currentStrength = computeStrength(strength, decayRate, daysSinceAccess);
    const category = categorize(currentStrength);

    if (category === "critical" || category === "forgotten") {
      criticalMemories.push({
        bucketId: row.bucket_id,
        canonical: row.canonical,
        strength: currentStrength,
        importance: Number(row.importance),
        daysSinceAccess: Math.round(daysSinceAccess * 10) / 10,
      });
    }
  }

  criticalMemories.sort((a, b) => {
    const importanceDiff = b.importance - a.importance;
    if (importanceDiff !== 0) return importanceDiff;
    return a.strength - b.strength;
  });

  return criticalMemories;
}

async function hasRecentReminder(userId: string): Promise<boolean> {
  const db = getPool();

  const result = await db.query(
    `SELECT created_at FROM reminders
     WHERE user_id = $1 AND dismissed = false
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) return false;

  const lastReminder = new Date(result.rows[0].created_at);
  const hoursSinceLastReminder = (Date.now() - lastReminder.getTime()) / (1000 * 60 * 60);

  return hoursSinceLastReminder < CHECK_INTERVAL_HOURS;
}

async function generateAndStoreReminder(
  userId: string,
  criticalMemories: ReminderMemory[]
): Promise<{ reminderId: string; message: string; memoryCount: number }> {
  const db = getPool();
  const reminderId = uuidv4();
  const topMemories = criticalMemories.slice(0, MAX_TOPICS_SHOWN);
  const message = buildReminderMessage(topMemories);
  const memoriesJson = JSON.stringify(
    topMemories.map((m) => ({
      bucketId: m.bucketId,
      canonical: m.canonical,
      strength: m.strength,
      importance: m.importance,
      daysSinceAccess: m.daysSinceAccess,
    }))
  );

  await db.query(
    `INSERT INTO reminders (reminder_id, user_id, message, memories, dismissed)
     VALUES ($1, $2, $3, $4::jsonb, false)`,
    [reminderId, userId, message, memoriesJson]
  );

  return {
    reminderId,
    message,
    memoryCount: topMemories.length,
  };
}

interface ReminderDispatchResult {
  usersScanned: number;
  remindersGenerated: number;
  criticalMemoriesFound: number;
  details: Array<{
    userId: string;
    email: string;
    criticalCount: number;
    reminderGenerated: boolean;
    reminderId?: string;
    skipped?: boolean;
    skipReason?: string;
  }>;
  durationMs: number;
  startedAt: string;
  completedAt: string;
}

async function runReminderDispatch(): Promise<ReminderDispatchResult> {
  const start = Date.now();
  const startedAt = new Date().toISOString();
  const db = getPool();

  const users = await db.query<UserRow>(
    "SELECT user_id, email, display_name FROM users ORDER BY created_at"
  );

  const details: ReminderDispatchResult["details"] = [];
  let totalRemindersGenerated = 0;
  let totalCriticalFound = 0;

  for (const user of users.rows) {
    try {
      const critical = await scanCriticalMemories();
      totalCriticalFound += critical.length;

      if (critical.length === 0) {
        details.push({
          userId: user.user_id,
          email: user.email,
          criticalCount: 0,
          reminderGenerated: false,
          skipped: true,
          skipReason: "no_critical_memories",
        });
        continue;
      }

      const recentReminder = await hasRecentReminder(user.user_id);
      if (recentReminder) {
        details.push({
          userId: user.user_id,
          email: user.email,
          criticalCount: critical.length,
          reminderGenerated: false,
          skipped: true,
          skipReason: "recent_reminder_exists",
        });
        continue;
      }

      const reminder = await generateAndStoreReminder(user.user_id, critical);
      totalRemindersGenerated++;

      details.push({
        userId: user.user_id,
        email: user.email,
        criticalCount: critical.length,
        reminderGenerated: true,
        reminderId: reminder.reminderId,
      });

      console.log("Reminder generated", {
        userId: user.user_id,
        email: user.email,
        criticalCount: critical.length,
        reminderId: reminder.reminderId,
      });
    } catch (userError) {
      console.error("Reminder dispatch failed for user", {
        userId: user.user_id,
        email: user.email,
        error: (userError as Error).message,
      });

      details.push({
        userId: user.user_id,
        email: user.email,
        criticalCount: 0,
        reminderGenerated: false,
      });
    }
  }

  const durationMs = Date.now() - start;
  const completedAt = new Date().toISOString();

  console.log("Reminder dispatch complete", {
    usersScanned: users.rows.length,
    remindersGenerated: totalRemindersGenerated,
    criticalMemoriesFound: totalCriticalFound,
    durationMs,
  });

  return {
    usersScanned: users.rows.length,
    remindersGenerated: totalRemindersGenerated,
    criticalMemoriesFound: totalCriticalFound,
    details,
    durationMs,
    startedAt,
    completedAt,
  };
}

async function runForSingleUser(userId: string): Promise<{
  hasReminders: boolean;
  reminderId?: string;
  message?: string;
  criticalCount: number;
  durationMs: number;
}> {
  const start = Date.now();

  const critical = await scanCriticalMemories();

  if (critical.length === 0) {
    return {
      hasReminders: false,
      criticalCount: 0,
      durationMs: Date.now() - start,
    };
  }

  const recentReminder = await hasRecentReminder(userId);
  if (recentReminder) {
    return {
      hasReminders: false,
      criticalCount: critical.length,
      durationMs: Date.now() - start,
    };
  }

  const reminder = await generateAndStoreReminder(userId, critical);

  return {
    hasReminders: true,
    reminderId: reminder.reminderId,
    message: reminder.message,
    criticalCount: critical.length,
    durationMs: Date.now() - start,
  };
}

interface LambdaEvent {
  httpMethod?: string;
  body?: string | null;
  source?: string;
  "detail-type"?: string;
  pathParameters?: Record<string, string | null> | null;
  requestContext?: {
    authorizer?: {
      userId?: string;
      email?: string;
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

  console.log("Reminder handler invoked", {
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
    if (isScheduledEvent) {
      const result = await runReminderDispatch();

      return buildResponse(200, {
        message: "Reminder dispatch complete",
        usersScanned: result.usersScanned,
        remindersGenerated: result.remindersGenerated,
        criticalMemoriesFound: result.criticalMemoriesFound,
        details: result.details,
        durationMs: result.durationMs,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
      });
    }

    const userId =
      event.requestContext?.authorizer?.userId ??
      (typeof event.body === "string" ? (JSON.parse(event.body).userId as string) : null);

    if (!userId) {
      return buildResponse(400, { error: "userId is required" });
    }

    const result = await runForSingleUser(userId);

    return buildResponse(200, {
      hasReminders: result.hasReminders,
      reminder: result.hasReminders
        ? {
            reminderId: result.reminderId,
            message: result.message,
            criticalCount: result.criticalCount,
          }
        : null,
      criticalCount: result.criticalCount,
      durationMs: result.durationMs,
    });
  } catch (error) {
    console.error("Reminder handler error:", error);
    return buildResponse(500, {
      error: "Reminder dispatch failed",
      message: (error as Error).message,
    });
  }
}