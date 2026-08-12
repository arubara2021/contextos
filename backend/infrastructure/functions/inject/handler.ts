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

interface InjectedMemory {
  bucketId: string;
  label: string;
  definition: string;
  conceptType: string;
  relevanceScore: number;
  strength: number;
  source: string;
  rank: number;
}

interface ContextBlock {
  rawText: string;
  memories: InjectedMemory[];
  totalCandidates: number;
  budgetUsed: number;
  budgetMax: number;
}

const TYPE_PRIORITY: Record<string, number> = {
  decision: 1,
  problem: 2,
  fact: 3,
  code: 4,
  entity: 5,
  event: 6,
  preference: 7,
};

const SYSTEM_HEADER = `You are an AI assistant with access to the user's persistent memory. The following memories were retrieved from their knowledge base based on the current conversation. Use these memories to provide personalized, contextually relevant responses.

Guidelines:
- Reference memories naturally as if recalling past conversations
- If a memory is relevant, incorporate it into your response
- If multiple memories relate, synthesize them
- Do not list memories mechanically; weave them into natural conversation
- If no memories are relevant, respond normally without forcing references`;

function getStrengthCategory(strength: number): string {
  if (strength >= 0.7) return "strong";
  if (strength >= 0.4) return "fading";
  if (strength >= 0.1) return "critical";
  return "forgotten";
}

function sortByTypeAndRecency(memories: InjectedMemory[]): InjectedMemory[] {
  return [...memories].sort((a, b) => {
    const aPriority = TYPE_PRIORITY[a.conceptType] ?? 99;
    const bPriority = TYPE_PRIORITY[b.conceptType] ?? 99;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return b.relevanceScore - a.relevanceScore;
  });
}

function ensureDiversity(memories: InjectedMemory[], budget: number): InjectedMemory[] {
  if (memories.length <= 2) return memories;

  const sourceCount = new Map<string, number>();
  const maxSameSource = Math.ceil(budget * 0.6);
  const selected: InjectedMemory[] = [];
  const deferred: InjectedMemory[] = [];

  for (const mem of memories) {
    const source = mem.source || "unknown";
    const count = sourceCount.get(source) ?? 0;

    if (count >= maxSameSource && selected.length >= 2) {
      deferred.push(mem);
    } else {
      selected.push(mem);
      sourceCount.set(source, count + 1);
    }
  }

  const typeCount = new Map<string, number>();
  for (const mem of selected) {
    typeCount.set(mem.conceptType, (typeCount.get(mem.conceptType) ?? 0) + 1);
  }

  if (typeCount.size < 2 && selected.length >= 2 && deferred.length > 0) {
    const dominatedType = selected[0].conceptType;
    const dominatedIdx = selected.length - 1;
    const replacement = deferred.find((d) => d.conceptType !== dominatedType);

    if (replacement) {
      const swapped = selected[dominatedIdx];
      selected[dominatedIdx] = replacement;
      selected.sort((a, b) => {
        const aP = TYPE_PRIORITY[a.conceptType] ?? 99;
        const bP = TYPE_PRIORITY[b.conceptType] ?? 99;
        if (aP !== bP) return aP - bP;
        return b.relevanceScore - a.relevanceScore;
      });
    }
  }

  return selected;
}

function formatContextBlock(memories: InjectedMemory[]): string {
  if (memories.length === 0) return "";

  const lines: string[] = [SYSTEM_HEADER, "", "Retrieved memories:", ""];

  for (const memory of memories) {
    const typeLabel = memory.conceptType.toUpperCase();
    const strengthPct = Math.round(memory.strength * 100);
    const source = memory.source ? ` (source: ${memory.source})` : "";
    lines.push(
      `${memory.rank}. [${typeLabel}] ${memory.label}: ${memory.definition} [strength: ${strengthPct}%]${source}`
    );
  }

  return lines.join("\n");
}

interface ScoredCandidate {
  bucketId: string;
  label: string;
  definition: string;
  conceptType: string;
  strength: number;
  source: string;
  relevanceScore: number;
}

function computeBudget(specificity: number, numCandidates: number, maxBudget: number): number {
  if (numCandidates === 0) return 0;

  let adjusted: number;
  if (specificity > 0.8) {
    adjusted = Math.ceil(maxBudget * 0.6);
  } else if (specificity > 0.5) {
    adjusted = Math.ceil(maxBudget * 0.8);
  } else {
    adjusted = maxBudget;
  }

  return Math.max(1, Math.min(adjusted, numCandidates));
}

interface InjectResult {
  contextBlock: ContextBlock;
  selectedMemories: InjectedMemory[];
  availableMemories: InjectedMemory[];
  timings: {
    assemblyMs: number;
  };
}

async function assembleContext(
  candidates: ScoredCandidate[],
  specificity: number,
  maxBudget: number
): Promise<InjectResult> {
  const start = Date.now();

  if (candidates.length === 0) {
    return {
      contextBlock: {
        rawText: "",
        memories: [],
        totalCandidates: 0,
        budgetUsed: 0,
        budgetMax: 0,
      },
      selectedMemories: [],
      availableMemories: [],
      timings: { assemblyMs: 0 },
    };
  }

  const sorted = [...candidates].sort((a, b) => b.relevanceScore - a.relevanceScore);

  const budget = computeBudget(specificity, sorted.length, maxBudget);

  const withRank: InjectedMemory[] = sorted.map((c, i) => ({
    bucketId: c.bucketId,
    label: c.label,
    definition: c.definition,
    conceptType: c.conceptType,
    relevanceScore: Math.round(c.relevanceScore * 10000) / 10000,
    strength: Math.round(c.strength * 10000) / 10000,
    source: c.source,
    rank: i + 1,
  }));

  const diversified = ensureDiversity(withRank, budget);
  const selected = sortByTypeAndRecency(diversified).slice(0, budget);

  for (let i = 0; i < selected.length; i++) {
    selected[i].rank = i + 1;
  }

  const selectedIds = new Set(selected.map((m) => m.bucketId));
  const available = withRank.filter((m) => !selectedIds.has(m.bucketId));

  const rawText = formatContextBlock(selected);

  const assemblyMs = Date.now() - start;

  return {
    contextBlock: {
      rawText,
      memories: selected,
      totalCandidates: candidates.length,
      budgetUsed: selected.length,
      budgetMax: budget,
    },
    selectedMemories: selected,
    availableMemories: available,
    timings: { assemblyMs },
  };
}

async function refreshStrength(db: Pool, bucketIds: string[]): Promise<void> {
  if (bucketIds.length === 0) return;

  for (const bucketId of bucketIds) {
    try {
      await db.query(
        `UPDATE buckets
         SET last_accessed = now(), access_count = access_count + 1
         WHERE bucket_id = $1`,
        [bucketId]
      );
    } catch (error) {
      console.warn("Failed to refresh strength for bucket:", bucketId);
    }
  }
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
  console.log("Inject handler invoked", {
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

    if (!Array.isArray(body.candidates)) {
      return buildResponse(400, { error: "candidates must be an array" });
    }

    const candidates: ScoredCandidate[] = [];
    for (const item of body.candidates) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).bucketId === "string" &&
        typeof (item as Record<string, unknown>).label === "string" &&
        typeof (item as Record<string, unknown>).relevanceScore === "number"
      ) {
        const obj = item as Record<string, unknown>;
        candidates.push({
          bucketId: obj.bucketId as string,
          label: obj.label as string,
          definition: typeof obj.definition === "string" ? obj.definition : "",
          conceptType: typeof obj.conceptType === "string" ? obj.conceptType : "fact",
          strength: typeof obj.strength === "number" ? obj.strength : 0.5,
          source: typeof obj.source === "string" ? obj.source : "",
          relevanceScore: obj.relevanceScore as number,
        });
      }
    }

    const specificity = typeof body.specificity === "number"
      ? Math.max(0, Math.min(1, body.specificity))
      : 0.5;

    const maxBudget = typeof body.maxBudget === "number"
      ? Math.max(1, Math.min(50, body.maxBudget))
      : Number(process.env.MAX_CONTEXT_MEMORIES) || 20;

    const result = await assembleContext(candidates, specificity, maxBudget);

    const db = getPool();
    const selectedIds = result.selectedMemories.map((m) => m.bucketId);
    await refreshStrength(db, selectedIds);

    return buildResponse(200, {
      contextBlock: result.contextBlock,
      selectedMemories: result.selectedMemories,
      availableMemories: result.availableMemories,
      timings: result.timings,
    });
  } catch (error) {
    console.error("Inject handler error:", error);
    return buildResponse(500, {
      error: "Internal server error",
      message: (error as Error).message,
    });
  }
}