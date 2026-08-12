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

function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  let count = words.length;
  for (const word of words) {
    if (word.length > 6) count += Math.floor(word.length / 4) - 1;
  }
  return count;
}

function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]+`/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*{1,3}([^*]+)\*{1,3}/g, "$1")
    .replace(/$$([^$$]+)\]$$[^)]+$$/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function splitIntoChunks(text: string, maxTokens: number = 250): string[] {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  const totalTokens = estimateTokens(cleaned);
  if (totalTokens <= maxTokens) return [cleaned];

  const paragraphs = cleaned.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;

    const currentTokens = estimateTokens(current);
    const paragraphTokens = estimateTokens(paragraph);

    if (currentTokens + paragraphTokens > maxTokens && current.trim()) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function callBedrock(
  modelId: string,
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );

  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const command = new InvokeModelCommand({
    modelId,
    contentType: "application/json",
    accept: "application/json",
    body,
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  if (responseBody.content && Array.isArray(responseBody.content)) {
    return responseBody.content
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("");
  }

  return responseBody.completion || "";
}

async function generateEmbedding(text: string): Promise<number[]> {
  const { BedrockRuntimeClient, InvokeModelCommand } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );

  const client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || "us-east-1",
  });

  const body = JSON.stringify({ inputText: text.trim() });

  const command = new InvokeModelCommand({
    modelId: process.env.BEDROCK_EMBEDDING_MODEL_ID || "amazon.titan-embed-text-v2:0",
    contentType: "application/json",
    accept: "application/json",
    body,
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  if (Array.isArray(responseBody.embedding)) {
    return responseBody.embedding.map(Number);
  }

  return [];
}

function parseJsonResponse(response: string): unknown[] {
  const trimmed = response.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed === "object" && parsed !== null) return [parsed];
  } catch {
    // continue
  }

  const arrayMatch = trimmed.match(/$$[\s\S]*$$/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // continue
    }
  }

  const objectMatches = trimmed.match(/\{[\s\S]*?\}/g);
  if (objectMatches) {
    const results: unknown[] = [];
    for (const match of objectMatches) {
      try {
        results.push(JSON.parse(match));
      } catch {
        // skip
      }
    }
    if (results.length > 0) return results;
  }

  return [];
}

const EXTRACTION_PROMPT = `You are an expert concept extraction system. Extract structured concepts from text.

For each concept, output a JSON object with:
- "label": concise name (2-5 words)
- "definition": clear description (1-2 sentences)
- "type": one of "problem", "decision", "fact", "entity", "event", "preference", "code"
- "importance": integer 1-10
- "related": array of related terms

Output ONLY a valid JSON array. No markdown, no explanation.`;

interface ExtractedConcept {
  label: string;
  definition: string;
  type: string;
  importance: number;
  related: string[];
}

function normalizeKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .sort()
    .join("_");
}

function getDecayRate(importance: number): number {
  if (importance >= 8) return 0.1;
  if (importance >= 5) return 0.15;
  return 0.2;
}

interface IngestResult {
  message: string;
  sessionId: string;
  chunksProcessed: number;
  conceptsExtracted: number;
  newBuckets: number;
  mergedBuckets: number;
  durationMs: number;
}

async function ingestMessage(
  role: string,
  content: string,
  sessionId: string,
  source: string
): Promise<IngestResult> {
  const start = Date.now();
  const db = getPool();

  const chunks = splitIntoChunks(content);
  let conceptsExtracted = 0;
  let newBuckets = 0;
  let mergedBuckets = 0;

  for (const chunk of chunks) {
    try {
      const rawResponse = await callBedrock(
        process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0",
        EXTRACTION_PROMPT,
        chunk
      );

      const rawConcepts = parseJsonResponse(rawResponse) as ExtractedConcept[];

      for (const raw of rawConcepts) {
        if (!raw.label || !raw.definition) continue;
        if (typeof raw.label !== "string" || typeof raw.definition !== "string") continue;

        const label = raw.label.trim();
        const definition = raw.definition.trim();
        const conceptType = typeof raw.type === "string" ? raw.type : "fact";
        const importance = typeof raw.importance === "number"
          ? Math.max(1, Math.min(10, Math.round(raw.importance)))
          : 5;

        conceptsExtracted++;

        const normalized = normalizeKey(label);

        const existing = await db.query(
          "SELECT bucket_id FROM buckets WHERE normalized = $1 LIMIT 1",
          [normalized]
        );

        let bucketId: string;

        if (existing.rows.length > 0) {
          bucketId = existing.rows[0].bucket_id;

          await db.query(
            `INSERT INTO bucket_items (bucket_id, label, definition, source)
             VALUES ($1, $2, $3, $4)`,
            [bucketId, label, definition, source]
          );

          await db.query(
            `UPDATE buckets
             SET importance = GREATEST(importance, $1),
                 last_accessed = now(),
                 access_count = access_count + 1
             WHERE bucket_id = $2`,
            [importance, bucketId]
          );

          mergedBuckets++;
        } else {
          const decayRate = getDecayRate(importance);

          const result = await db.query(
            `INSERT INTO buckets (canonical, normalized, strength, importance, concept_type, decay_rate)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING bucket_id`,
            [label, normalized, 0.5, importance, conceptType, decayRate]
          );

          bucketId = result.rows[0].bucket_id;

          await db.query(
            `INSERT INTO bucket_items (bucket_id, label, definition, source)
             VALUES ($1, $2, $3, $4)`,
            [bucketId, label, definition, source]
          );

          newBuckets++;
        }

        try {
          const embeddingText = `${label}: ${definition}`;
          const embedding = await generateEmbedding(embeddingText);

          if (embedding.length > 0) {
            await db.query(
              `INSERT INTO embeddings (bucket_id, vector)
               VALUES ($1, $2)
               ON CONFLICT (bucket_id) DO UPDATE SET vector = EXCLUDED.vector, created_at = now()`,
              [bucketId, `[${embedding.join(",")}]`]
            );
          }
        } catch (embedError) {
          console.warn("Embedding generation failed:", (embedError as Error).message);
        }
      }
    } catch (chunkError) {
      console.warn("Chunk processing failed:", (chunkError as Error).message);
    }
  }

  const durationMs = Date.now() - start;

  return {
    message: "Ingestion complete",
    sessionId,
    chunksProcessed: chunks.length,
    conceptsExtracted,
    newBuckets,
    mergedBuckets,
    durationMs,
  };
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
  console.log("Ingest handler invoked", {
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
      return buildResponse(400, { error: "Invalid JSON in request body" });
    }

    if (typeof body.content !== "string" || !body.content.trim()) {
      return buildResponse(400, { error: "content is required and must be a non-empty string" });
    }

    if (typeof body.sessionId !== "string" || !body.sessionId.trim()) {
      return buildResponse(400, { error: "sessionId is required" });
    }

    const role = typeof body.role === "string" ? body.role : "user";
    const content = body.content as string;
    const sessionId = body.sessionId as string;
    const source = typeof body.source === "string" ? body.source : `api:${sessionId}`;

    const result = await ingestMessage(role, content, sessionId, source);

    return buildResponse(200, result);
  } catch (error) {
    console.error("Ingest handler error:", error);
    return buildResponse(500, {
      error: "Internal server error",
      message: (error as Error).message,
    });
  }
}