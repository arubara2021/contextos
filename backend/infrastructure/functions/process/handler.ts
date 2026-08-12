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

interface ProcessedResponse {
  shouldReingest: boolean;
  confirmationIds: string[];
  newInformationDetected: boolean;
  keyTopics: string[];
  actionHints: string[];
}

const CONFIRMATION_PHRASES = [
  "as you mentioned",
  "as we discussed",
  "you are right",
  "that is correct",
  "exactly",
  "as you said",
  "you're right",
  "that's right",
  "indeed",
  "correct",
  "as i recall",
  "based on what you told me",
  "building on your point",
  "as you pointed out",
  "remember when",
  "like you said",
  "per your note",
  "from our previous conversation",
  "as noted",
  "as established",
  "continuing from",
  "to follow up",
  "following up on",
];

const NEW_INFORMATION_PHRASES = [
  "new information",
  "update",
  "correction",
  "actually",
  "turns out",
  "i realized",
  "changed my mind",
  "new approach",
  "different from",
  "correction:",
  "update:",
  "note:",
  "important:",
  "btw",
  "by the way",
];

const TOPIC_PATTERNS = [
  /(?:about|regarding|concerning|on the topic of|when it comes to)\s+([A-Z][a-zA-Z\s]{2,30})/g,
  /(?:discussed|talked about|mentioned|covered)\s+([A-Z][a-zA-Z\s]{2,30})/g,
  /(?:the\s+)?([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\s+(?:project|system|approach|method|framework)/g,
];

function detectConfirmations(normalized: string, memoryLabels: string[]): string[] {
  const confirmed: string[] = [];
  const hasPhrase = CONFIRMATION_PHRASES.some((phrase) => normalized.includes(phrase));
  if (!hasPhrase) return confirmed;

  for (const label of memoryLabels) {
    const normalizedLabel = label.toLowerCase();
    if (
      normalized.includes(normalizedLabel) ||
      normalized.includes(normalizedLabel.replace(/_/g, " "))
    ) {
      confirmed.push(label);
    }
  }

  return confirmed;
}

function detectNewInformation(normalized: string): boolean {
  return NEW_INFORMATION_PHRASES.some((phrase) => normalized.includes(phrase));
}

function extractTopics(text: string): string[] {
  const topics = new Set<string>();

  for (const pattern of TOPIC_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match[1]) {
        const topic = match[1].trim();
        if (topic.length >= 2 && topic.length <= 50) {
          topics.add(topic);
        }
      }
    }
  }

  return Array.from(topics).slice(0, 10);
}

function extractActionHints(normalized: string): string[] {
  const hints: string[] = [];

  if (normalized.includes("should i") || normalized.includes("want me to")) {
    hints.push("action_requested");
  }
  if (normalized.includes("remind me") || normalized.includes("remind you")) {
    hints.push("reminder_requested");
  }
  if (normalized.includes("save this") || normalized.includes("remember this")) {
    hints.push("explicit_save");
  }
  if (normalized.includes("don't forget") || normalized.includes("do not forget")) {
    hints.push("emphasis_save");
  }
  if (normalized.includes("next time") || normalized.includes("in the future")) {
    hints.push("future_reference");
  }

  return hints;
}

function processResponse(aiResponse: string, memoryLabels: string[]): ProcessedResponse {
  if (!aiResponse || !aiResponse.trim()) {
    return {
      shouldReingest: false,
      confirmationIds: [],
      newInformationDetected: false,
      keyTopics: [],
      actionHints: [],
    };
  }

  const normalized = aiResponse.toLowerCase();
  const confirmationIds = detectConfirmations(normalized, memoryLabels);
  const newInformationDetected = detectNewInformation(normalized);
  const keyTopics = extractTopics(aiResponse);
  const actionHints = extractActionHints(normalized);
  const wordCount = aiResponse.split(/\s+/).filter((w) => w.length > 0).length;
  const shouldReingest = newInformationDetected || wordCount > 20;

  return {
    shouldReingest,
    confirmationIds,
    newInformationDetected,
    keyTopics,
    actionHints,
  };
}

async function storeContradictionIfNeeded(
  db: Pool,
  userId: string,
  newLabel: string,
  newDefinition: string
): Promise<string | null> {
  try {
    const normalized = newLabel.toLowerCase().trim();
    const existing = await db.query(
      `SELECT bucket_id, canonical FROM buckets
       WHERE canonical ILIKE $1
       LIMIT 5`,
      [`%${normalized}%`]
    );

    for (const row of existing.rows) {
      const existingDef = await db.query(
        `SELECT definition FROM bucket_items
         WHERE bucket_id = $1 AND definition IS NOT NULL
         ORDER BY timestamp DESC LIMIT 1`,
        [row.bucket_id]
      );

      if (existingDef.rows.length === 0) continue;

      const oldDef = existingDef.rows[0].definition as string;
      const hasContradiction = detectContradiction(oldDef, newDefinition);

      if (hasContradiction) {
        const contradictionId = uuidv4();
        await db.query(
          `INSERT INTO contradictions (contradiction_id, user_id, existing_bucket_id, new_information, conflict_description, resolved)
           VALUES ($1, $2, $3, $4, $5, false)`,
          [
            contradictionId,
            userId,
            row.bucket_id,
            newDefinition,
            `Conflicting definitions for "${newLabel}"`,
          ]
        );
        return contradictionId;
      }
    }

    return null;
  } catch (error) {
    console.warn("Contradiction check failed:", (error as Error).message);
    return null;
  }
}

function detectContradiction(existingDef: string, newDef: string): boolean {
  const existingLower = existingDef.toLowerCase();
  const newLower = newDef.toLowerCase();

  if (existingLower === newLower) return false;

  const patterns = [
    { positive: "is", negative: "is not" },
    { positive: "can", negative: "cannot" },
    { positive: "does", negative: "does not" },
    { positive: "will", negative: "will not" },
    { positive: "should", negative: "should not" },
    { positive: "always", negative: "never" },
    { positive: "increases", negative: "decreases" },
    { positive: "enables", negative: "disables" },
    { positive: "true", negative: "false" },
    { positive: "correct", negative: "incorrect" },
  ];

  for (const pattern of patterns) {
    const hasPosInOld = existingLower.includes(pattern.positive);
    const hasNegInNew = newLower.includes(pattern.negative);
    const hasNegInOld = existingLower.includes(pattern.negative);
    const hasPosInNew = newLower.includes(pattern.positive);

    if ((hasPosInOld && hasNegInNew) || (hasNegInOld && hasPosInNew)) {
      return true;
    }
  }

  return false;
}

interface LambdaEvent {
  httpMethod?: string;
  body?: string | null;
  pathParameters?: Record<string, string | null> | null;
  queryStringParameters?: Record<string, string | null> | null;
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
  console.log("Process handler invoked", {
    method: event.httpMethod,
    path: event.pathParameters,
  });

  if (event.httpMethod === "OPTIONS") {
    return buildResponse(200, { message: "OK" });
  }

  if (event.httpMethod !== "POST") {
    return buildResponse(405, { error: "Method not allowed" });
  }

  try {
    if (!event.body) {
      return buildResponse(400, { error: "Request body is required" });
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(event.body);
    } catch {
      return buildResponse(400, { error: "Invalid JSON" });
    }

    if (typeof body.response !== "string" || !body.response.trim()) {
      return buildResponse(400, { error: "response is required" });
    }

    const response = body.response as string;
    const memoryLabels = Array.isArray(body.memoryLabels)
      ? (body.memoryLabels as unknown[]).filter((l): l is string => typeof l === "string")
      : [];

    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    const userId = typeof body.userId === "string"
      ? body.userId
      : event.requestContext?.authorizer?.userId ?? null;

    const result = processResponse(response, memoryLabels);

    let contradictionId: string | null = null;
    if (result.newInformationDetected && userId) {
      try {
        contradictionId = await storeContradictionIfNeeded(
          getPool(),
          userId,
          "response_content",
          response.substring(0, 1000)
        );
      } catch (contradictionError) {
        console.warn("Contradiction storage failed:", (contradictionError as Error).message);
      }
    }

    if (sessionId && result.shouldReingest) {
      try {
        const db = getPool();
        const messageId = uuidv4();
        await db.query(
          `INSERT INTO messages (message_id, session_id, role, content, timestamp)
           VALUES ($1, $2, $3, $4, now())`,
          [messageId, sessionId, "assistant", response]
        );
      } catch (storeError) {
        console.warn("Failed to store processed response:", (storeError as Error).message);
      }
    }

    return buildResponse(200, {
      shouldReingest: result.shouldReingest,
      confirmationIds: result.confirmationIds,
      newInformationDetected: result.newInformationDetected,
      keyTopics: result.keyTopics,
      actionHints: result.actionHints,
      contradictionId,
      sessionId,
    });
  } catch (error) {
    console.error("Process handler error:", error);
    return buildResponse(500, {
      error: "Internal server error",
      message: (error as Error).message,
    });
  }
}