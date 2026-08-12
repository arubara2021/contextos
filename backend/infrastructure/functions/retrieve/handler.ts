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

function parseJsonResponse(response: string): Record<string, unknown> | null {
  const trimmed = response.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // continue
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      return JSON.parse(objectMatch[0]);
    } catch {
      // continue
    }
  }

  return null;
}

const ANALYSIS_PROMPT = `You are a query analyzer. Analyze the user query and output a JSON object with:
- "keyTerms": array of important terms
- "intent": one of "recall", "compare", "build_on", "verify", "explore", "summarize", "debug", "explain"
- "specificity": number 0-1 (0=broad, 1=specific)
- "preferredTypes": array from "problem", "decision", "fact", "entity", "event", "preference", "code"

Output ONLY valid JSON. No markdown, no explanation.`;

interface RetrievedMemory {
  bucketId: string;
  label: string;
  definition: string;
  conceptType: string;
  relevanceScore: number;
  strength: number;
  source: string;
}

interface RetrieveResult {
  query: string;
  queryAnalysis: {
    keyTerms: string[];
    intent: string;
    specificity: number;
    preferredTypes: string[];
  };
  candidates: RetrievedMemory[];
  totalCandidates: number;
  retrievalTimeMs: number;
}

async function retrieve(query: string, limit: number = 20): Promise<RetrieveResult> {
  const start = Date.now();
  const db = getPool();

  let queryAnalysis = {
    keyTerms: [] as string[],
    intent: "recall",
    specificity: 0.5,
    preferredTypes: ["fact"],
  };

  try {
    const analysisResponse = await callBedrock(
      process.env.BEDROCK_MODEL_ID || "anthropic.claude-3-5-sonnet-20241022-v2:0",
      ANALYSIS_PROMPT,
      query
    );

    const parsed = parseJsonResponse(analysisResponse);
    if (parsed) {
      queryAnalysis = {
        keyTerms: Array.isArray(parsed.keyTerms)
          ? (parsed.keyTerms as string[]).filter((t) => typeof t === "string").slice(0, 10)
          : [],
        intent: typeof parsed.intent === "string" ? parsed.intent : "recall",
        specificity: typeof parsed.specificity === "number" ? parsed.specificity : 0.5,
        preferredTypes: Array.isArray(parsed.preferredTypes)
          ? (parsed.preferredTypes as string[]).filter((t) => typeof t === "string")
          : ["fact"],
      };
    }
  } catch (analysisError) {
    console.warn("Query analysis failed:", (analysisError as Error).message);

    const words = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been",
      "have", "has", "had", "do", "does", "did", "will", "would",
      "should", "could", "may", "might", "can", "to", "of", "in",
      "for", "on", "with", "at", "by", "from", "what", "how", "why",
      "when", "where", "which", "who", "and", "but", "or", "not",
    ]);

    queryAnalysis.keyTerms = words.filter((w) => !stopWords.has(w)).slice(0, 10);
  }

  const candidateScores = new Map<string, number>();
  const candidateDetails = new Map<string, RetrievedMemory>();

  if (queryAnalysis.keyTerms.length > 0) {
    try {
      const embedding = await generateEmbedding(query);

      if (embedding.length > 0) {
        const vectorStr = `[${embedding.join(",")}]`;

        const vectorResults = await db.query(
          `SELECT bucket_id,
                  1 - (vector <=> $1::float8[]) AS similarity
           FROM embeddings
           ORDER BY vector <=> $1::float8[]
           LIMIT $2`,
          [vectorStr, limit]
        );

        for (const row of vectorResults.rows) {
          const similarity = Number(row.similarity);
          if (similarity > 0.3) {
            candidateScores.set(row.bucket_id, (candidateScores.get(row.bucket_id) ?? 0) + similarity);
          }
        }
      }
    } catch (vectorError) {
      console.warn("Vector search failed:", (vectorError as Error).message);
    }

    for (const term of queryAnalysis.keyTerms) {
      try {
        const textResults = await db.query(
          `SELECT bucket_id
           FROM buckets
           WHERE canonical ILIKE $1
              OR bucket_id IN (
                SELECT bucket_id FROM bucket_items
                WHERE label ILIKE $1 OR definition ILIKE $1
              )
           ORDER BY strength DESC
           LIMIT $2`,
          [`%${term}%`, limit]
        );

        for (let i = 0; i < textResults.rows.length; i++) {
          const bucketId = textResults.rows[i].bucket_id;
          const score = 1 - (i / textResults.rows.length) * 0.5;
          candidateScores.set(bucketId, (candidateScores.get(bucketId) ?? 0) + score);
        }
      } catch (textError) {
        console.warn("Text search failed for term:", term, (textError as Error).message);
      }
    }
  }

  const sortedCandidates = Array.from(candidateScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);

  for (const [bucketId, score] of sortedCandidates) {
    try {
      const bucketResult = await db.query(
        `SELECT b.bucket_id, b.canonical, b.strength, b.concept_type, b.importance,
                bi.definition, bi.source
         FROM buckets b
         LEFT JOIN bucket_items bi ON b.bucket_id = bi.bucket_id
         WHERE b.bucket_id = $1
         ORDER BY bi.timestamp DESC
         LIMIT 1`,
        [bucketId]
      );

      if (bucketResult.rows.length > 0) {
        const row = bucketResult.rows[0];
        candidateDetails.set(bucketId, {
          bucketId: row.bucket_id,
          label: row.canonical,
          definition: row.definition ?? "",
          conceptType: row.concept_type,
          relevanceScore: Math.round(score * 10000) / 10000,
          strength: Number(row.strength),
          source: row.source ?? "",
        });
      }
    } catch (detailError) {
      console.warn("Failed to get bucket details:", bucketId, (detailError as Error).message);
    }
  }

  const candidates = sortedCandidates
    .map(([bucketId]) => candidateDetails.get(bucketId))
    .filter((c): c is RetrievedMemory => c !== undefined);

  const retrievalTimeMs = Date.now() - start;

  return {
    query,
    queryAnalysis,
    candidates,
    totalCandidates: candidateScores.size,
    retrievalTimeMs,
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
  console.log("Retrieve handler invoked", {
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

    if (typeof body.query !== "string" || !body.query.trim()) {
      return buildResponse(400, { error: "query is required" });
    }

    const query = (body.query as string).trim();
    const limit = typeof body.limit === "number" ? Math.min(Math.max(body.limit, 1), 50) : 20;

    const result = await retrieve(query, limit);

    return buildResponse(200, {
      query: result.query,
      analysis: result.queryAnalysis,
      memories: result.candidates.map((c) => ({
        bucketId: c.bucketId,
        label: c.label,
        definition: c.definition,
        conceptType: c.conceptType,
        relevanceScore: c.relevanceScore,
        strength: c.strength,
        source: c.source,
      })),
      totalFound: result.totalCandidates,
      returned: result.candidates.length,
      retrievalTimeMs: result.retrievalTimeMs,
    });
  } catch (error) {
    console.error("Retrieve handler error:", error);
    return buildResponse(500, {
      error: "Internal server error",
      message: (error as Error).message,
    });
  }
}