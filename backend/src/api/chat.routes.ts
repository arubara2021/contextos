import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../auth/middleware";
import { getDependencies } from "./dependencies";
import { validateChatRequest } from "../models/message.model";
import { AIError } from "../agent/ai-provider";
import type { KnowledgeBaseState } from "../agent/prompt-builder";
import { queryMany } from "../database";
import config from "../config";
import logger from "../utils/logger";

const router = Router();

const CONTEXT_BUDGET_DEFAULT = 20;
const AVAILABLE_MEMORIES_LIMIT = 8;

const GREETING_RE =
  /^\s*(hi|hello|hey|howdy|yo|sup|hiya|hola|hey\s+there|hello\s+there|good\s+(morning|afternoon|evening|night)|how\s+are\s+(you|ya|things|u)|how('?s| is)\s+it\s+going|what'?s\s+up|what'?s\s+good|thanks|thank\s+you|thanku|thx|ty|cheers|appreciate\s+it|bye|goodbye|see\s+(ya|you)|later|ciao|take\s+care|ok|okay|k|cool|got\s+it|gotcha|understood|nice|great|awesome|sweet|perfect|sure|yep|yeah|nope|no)\b[^a-z0-9]{0,8}$/i;

const IDENTITY_RE =
  /^\s*(who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+do\s+you\s+do|what\s+are\s+you\s+good\s+at|what\s+is\s+contextos|what\s+does\s+contextos\s+do|how\s+do\s+i\s+(start|begin|use\s+this)|help\s+me\s+get\s+started|help)\b[^a-z0-9]{0,10}$/i;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

function isGreetingOrPleasantry(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 48) return false;
  return GREETING_RE.test(trimmed);
}

function isIdentityQuestion(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  return IDENTITY_RE.test(trimmed);
}

function isSmallTalkMessage(text: string): boolean {
  return isGreetingOrPleasantry(text) || isIdentityQuestion(text);
}

function clampUnit(value: unknown): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(1, num));
}

function round4(value: unknown): number {
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return 0;
  return Math.round(Math.max(0, Math.min(1, num)) * 10000) / 10000;
}

function nonNegativeInt(value: unknown): number {
  const num = typeof value === "number" ? value : parseInt(String(value), 10);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.round(num));
}

async function getKnowledgeBaseState(
  userId: string
): Promise<KnowledgeBaseState> {
  try {
    const [memoryRows, documentRows] = await Promise.all([
      queryMany<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM buckets WHERE user_id = $1::uuid`,
        [userId]
      ),
      queryMany<{ count: number }>(
        `SELECT COUNT(*)::int AS count FROM documents WHERE user_id = $1::uuid`,
        [userId]
      ),
    ]);
    const memoryCount = nonNegativeInt(memoryRows[0]?.count);
    const documentCount = nonNegativeInt(documentRows[0]?.count);
    return {
      memoryCount,
      documentCount,
      hasKnowledge: memoryCount > 0,
    };
  } catch (error) {
    logger.warn("Knowledge base state lookup failed", {
      userId,
      error: (error as Error).message,
    });
    return { memoryCount: 0, documentCount: 0, hasKnowledge: false };
  }
}

function toModelFailurePayload(
  error: Error,
  isProduction: boolean
): { status: number; body: Record<string, unknown> } {
  if (error instanceof AIError) {
    return {
      status: 502,
      body: {
        error: "AI provider unavailable",
        code: error.code,
        provider: error.provider,
        task: error.task,
        ...(isProduction ? {} : { detail: error.message }),
      },
    };
  }
  return {
    status: 502,
    body: {
      error: "AI provider unavailable",
      ...(isProduction ? {} : { detail: error.message }),
    },
  };
}

function toApiMemory(memory: any, traceItem: any, fallbackRank: number): any {
  const sourceValue =
    typeof memory?.source === "string" && memory.source.length > 0
      ? memory.source
      : typeof memory?.sources?.[0] === "string" && memory.sources[0].length > 0
        ? memory.sources[0]
        : traceItem?.source ?? null;

  return {
    bucketId:
      typeof memory?.bucketId === "string" && isValidUuid(memory.bucketId)
        ? memory.bucketId
        : traceItem?.bucketId ?? null,
    label: String(memory?.label ?? memory?.canonical ?? traceItem?.label ?? ""),
    definition:
      typeof memory?.definition === "string"
        ? memory.definition
        : traceItem?.definition ?? null,
    conceptType: String(
      memory?.conceptType ?? traceItem?.conceptType ?? "fact"
    ),
    relevanceScore: clampUnit(
      memory?.relevanceScore ??
      memory?.scores?.relevanceScore ??
      traceItem?.relevanceScore ??
      0
    ),
    strength: clampUnit(memory?.strength ?? traceItem?.strength ?? 0),
    source: sourceValue,
    rank: nonNegativeInt(memory?.rank ?? traceItem?.rank ?? fallbackRank),
    documentId:
      typeof memory?.documentId === "string" && isValidUuid(memory.documentId)
        ? memory.documentId
        : traceItem?.documentId ?? null,
    documentFilename:
      typeof memory?.documentFilename === "string" &&
        memory.documentFilename.length > 0
        ? memory.documentFilename
        : traceItem?.documentFilename ?? null,
    connectionConfidence: clampUnit(
      memory?.connectionConfidence ?? traceItem?.connectionConfidence ?? 0
    ),
    connectedToCurrentDocument: Boolean(
      memory?.connectedToCurrentDocument ??
      traceItem?.connectedToCurrentDocument ??
      false
    ),
  };
}

function normalizeRelatedDocuments(rows: unknown[]): any[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(
      (item): item is Record<string, any> =>
        Boolean(item && typeof item === "object")
    )
    .map((row) => ({
      documentId: String(row.documentId ?? row.document_id ?? ""),
      filename: String(row.filename ?? "Unknown document"),
      correlation: clampUnit(row.correlation ?? row.correlationScore ?? 0),
      sharedConcepts: nonNegativeInt(
        row.sharedConcepts ?? row.shared_bucket_count ?? 0
      ),
      edges: nonNegativeInt(row.edges ?? row.edge_count ?? 0),
      avgConfidence:
        row.avgConfidence === undefined && row.avg_confidence === undefined
          ? undefined
          : clampUnit(row.avgConfidence ?? row.avg_confidence),
    }))
    .filter((row) => isValidUuid(row.documentId))
    .slice(0, 10);
}

async function enrichMemoryTrace(trace: unknown[], userId: string): Promise<any[]> {
  if (!Array.isArray(trace)) return [];

  const documentIds = Array.from(
    new Set(
      trace
        .map((item: any) => item?.documentId)
        .filter((id): id is string => typeof id === "string" && isValidUuid(id))
    )
  );

  const filenames = new Map<string, string>();
  if (documentIds.length > 0) {
    try {
      const rows = await queryMany<{ document_id: string; filename: string }>(
        `SELECT document_id, filename
         FROM documents
         WHERE document_id = ANY($1::uuid[]) AND user_id = $2::uuid`,
        [documentIds, userId]
      );
      for (const row of rows) {
        filenames.set(row.document_id, row.filename);
      }
    } catch (error) {
      logger.debug("enrichMemoryTrace filename lookup failed", {
        userId,
        error: (error as Error).message,
      });
    }
  }

  return trace.map((item: any) => {
    const documentId =
      typeof item?.documentId === "string" && isValidUuid(item.documentId)
        ? item.documentId
        : null;

    return {
      rank: nonNegativeInt(item?.rank ?? 0),
      bucketId:
        typeof item?.bucketId === "string" && isValidUuid(item.bucketId)
          ? item.bucketId
          : null,
      label: String(item?.label ?? item?.canonical ?? ""),
      conceptType: String(item?.conceptType ?? item?.concept_type ?? "fact"),
      strength: clampUnit(item?.strength ?? 0),
      definition: typeof item?.definition === "string" ? item.definition : "",
      source:
        typeof item?.source === "string" && item.source.length > 0
          ? item.source
          : null,
      documentId,
      documentFilename:
        typeof item?.documentFilename === "string" &&
          item.documentFilename.length > 0
          ? item.documentFilename
          : filenames.get(documentId ?? "") ?? null,
      connectionConfidence: clampUnit(item?.connectionConfidence ?? 0),
      connectedToCurrentDocument: Boolean(item?.connectedToCurrentDocument ?? false),
      connectedMemories: Array.isArray(item?.connectedMemories)
        ? item.connectedMemories.slice(0, 5)
        : [],
    };
  });
}

function buildSourceDocuments(trace: any[]): any[] {
  const grouped = new Map<
    string,
    { documentId: string; filename: string; memoryCount: number }
  >();

  for (const item of trace) {
    const documentId = item?.documentId;
    const filename = item?.documentFilename;
    if (typeof documentId !== "string" || !isValidUuid(documentId)) continue;
    if (typeof filename !== "string" || filename.length === 0) continue;

    const existing = grouped.get(documentId);
    if (existing) {
      existing.memoryCount += 1;
    } else {
      grouped.set(documentId, {
        documentId,
        filename,
        memoryCount: 1,
      });
    }
  }

  return Array.from(grouped.values())
    .sort((a, b) => b.memoryCount - a.memoryCount)
    .slice(0, 5);
}

function buildConnectionConfidence(scoredCandidates: any[], trace: any[]): {
  average: number;
  top: number;
  connectedMemoryCount: number;
} {
  const values: number[] = [];

  if (Array.isArray(scoredCandidates)) {
    for (const candidate of scoredCandidates) {
      const value = clampUnit(candidate?.scores?.connectivityScore ?? 0);
      if (value > 0) values.push(value);
    }
  }

  if (Array.isArray(trace)) {
    for (const item of trace) {
      const value = clampUnit(item?.connectionConfidence ?? 0);
      if (value > 0) values.push(value);
    }
  }

  const connectedMemoryCount = Array.isArray(trace)
    ? trace.filter(
      (item) =>
        Boolean(item?.connectedToCurrentDocument) ||
        (Array.isArray(item?.connectedMemories) &&
          item.connectedMemories.length > 0) ||
        clampUnit(item?.connectionConfidence ?? 0) > 0
    ).length
    : 0;

  if (values.length === 0) {
    return {
      average: 0,
      top: 0,
      connectedMemoryCount,
    };
  }

  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const top = Math.max(...values);

  return {
    average: round4(average),
    top: round4(top),
    connectedMemoryCount,
  };
}

async function getRelatedDocumentHints(
  userId: string,
  relationshipStore: any,
  scopeDocumentId: string | undefined,
  trace: any[]
): Promise<any[]> {
  if (!isValidUuid(userId)) {
    return [];
  }

  let targetDocumentId =
    scopeDocumentId && isValidUuid(scopeDocumentId) ? scopeDocumentId : undefined;

  if (!targetDocumentId && Array.isArray(trace)) {
    const counts = new Map<string, number>();
    for (const item of trace) {
      const documentId = item?.documentId;
      if (typeof documentId !== "string" || !isValidUuid(documentId)) continue;
      counts.set(documentId, (counts.get(documentId) ?? 0) + 1);
    }

    let bestDocumentId: string | null = null;
    let bestCount = 0;
    for (const [documentId, count] of counts.entries()) {
      if (count > bestCount) {
        bestCount = count;
        bestDocumentId = documentId;
      }
    }
    targetDocumentId = bestDocumentId ?? undefined;
  }

  if (!targetDocumentId || !isValidUuid(targetDocumentId)) {
    return [];
  }

  try {
    if (typeof relationshipStore?.getRelatedDocuments === "function") {
      const rows = await relationshipStore.getRelatedDocuments(
        userId,
        targetDocumentId,
        5
      );
      return normalizeRelatedDocuments(rows);
    }
  } catch (error) {
    logger.debug("getRelatedDocumentHints via relationshipStore failed", {
      userId,
      targetDocumentId,
      error: (error as Error).message,
    });
  }

  try {
    const rows = await queryMany<any>(
      `WITH links AS (
         SELECT CASE
                  WHEN source_document_id = $2::uuid THEN target_document_id
                  ELSE source_document_id
                END AS other_document_id,
                correlation_score,
                shared_bucket_count,
                edge_count,
                avg_confidence
         FROM document_links
         WHERE user_id = $1::uuid
           AND (source_document_id = $2::uuid OR target_document_id = $2::uuid)
       )
       SELECT links.other_document_id::text AS document_id,
              d.filename,
              MAX(links.correlation_score)::float AS correlation,
              MAX(links.shared_bucket_count)::int AS shared_concepts,
              MAX(links.edge_count)::int AS edges,
              MAX(links.avg_confidence)::float AS avg_confidence
       FROM links
       JOIN documents d ON d.document_id = links.other_document_id
       WHERE d.user_id = $1::uuid
         AND links.other_document_id <> $2::uuid
       GROUP BY links.other_document_id, d.filename
       ORDER BY correlation DESC, edges DESC
       LIMIT $3`,
      [userId, targetDocumentId, 5]
    );
    return normalizeRelatedDocuments(rows);
  } catch (error) {
    logger.debug("getRelatedDocumentHints fallback failed", {
      userId,
      targetDocumentId,
      error: (error as Error).message,
    });
    return [];
  }
}

router.post(
  "/",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    const start = Date.now();

    try {
      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const validated = validateChatRequest(req.body);
      if (!validated) {
        res.status(400).json({
          error: "Invalid request",
          details: "Required fields: message (string), sessionId (string)",
        });
        return;
      }

      if (!isValidUuid(validated.sessionId)) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const {
        ingestionPipeline,
        sessionStore,
        rawStore,
        queryAnalyzer,
        retriever,
        assembler,
        modelRouter,
        promptBuilder,
        strengthTracker,
        relationshipStore,
      } = getDependencies();

      const sessionExists = await sessionStore.exists(validated.sessionId);
      if (!sessionExists) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      await sessionStore.updateSessionActivity(validated.sessionId);

      const timestamp = new Date().toISOString();
      const userMessageId = await rawStore.storeMessage(
        validated.sessionId,
        "user",
        validated.message,
        timestamp
      );

      const smallTalk = isSmallTalkMessage(validated.message);
      const knowledgeBase = await getKnowledgeBaseState(req.userId);

      if (smallTalk) {
        const promptPair = (promptBuilder as any).buildGreetingPrompt(
          validated.message,
          knowledgeBase
        );

        const modelStart = Date.now();
        let modelResult: any;
        try {
          modelResult = await modelRouter.send(
            promptPair.systemPrompt,
            promptPair.userPrompt,
            validated.modelId
          );
        } catch (error) {
          const failure = toModelFailurePayload(
            error as Error,
            config.server.isProduction
          );
          logger.error("AI chat provider failed", {
            sessionId: validated.sessionId,
            error: (error as Error).message,
          });
          res.status(failure.status).json(failure.body);
          return;
        }

        const aiTimestamp = new Date().toISOString();
        const aiMessage = await rawStore.storeMessage(
          validated.sessionId,
          "assistant",
          modelResult.response,
          aiTimestamp
        );

        try {
          (ingestionPipeline as any).ingestMessageAsync(
            "user",
            validated.message,
            `chat:${validated.sessionId}`,
            validated.sessionId,
            timestamp,
            userMessageId,
            req.userId
          );
          (ingestionPipeline as any).ingestMessageAsync(
            "assistant",
            modelResult.response,
            `chat:${validated.sessionId}`,
            validated.sessionId,
            aiTimestamp,
            aiMessage,
            req.userId
          );
        } catch (error) {
          logger.warn("Async message ingestion failed", {
            sessionId: validated.sessionId,
            error: (error as Error).message,
          });
        }

        res.status(200).json({
          message: {
            messageId: aiMessage,
            sessionId: validated.sessionId,
            role: "assistant",
            content: modelResult.response,
            timestamp: aiTimestamp,
          },
          injectedMemories: [],
          memoryTrace: [],
          sourceDocuments: [],
          relatedDocuments: [],
          connectionConfidence: {
            average: 0,
            top: 0,
            connectedMemoryCount: 0,
          },
          availableMemories: [],
          totalMemories: 0,
          knowledgeBase,
          queryAnalysis: {
            keyTerms: [],
            expandedTerms: [],
            intent: "chitchat",
            specificity: 0,
            isAbstractQuery: false,
            preferredTypes: [],
            documentScoped: false,
          },
          processingStats: {
            responseIngestion: null,
            context: {
              totalCandidates: 0,
              budgetUsed: 0,
              budgetMax: CONTEXT_BUDGET_DEFAULT,
              queryAnalysisMs: 0,
              retrievalTimeMs: 0,
              assemblyTimeMs: 0,
            },
            model: {
              modelUsed: modelResult.modelUsed,
              modelTimeMs: Date.now() - modelStart,
            },
            totalDurationMs: Date.now() - start,
          },
        });
        return;
      }

      const sessionDocId = await sessionStore.getDocumentId(validated.sessionId);
      const scopeDocId =
        sessionDocId && isValidUuid(sessionDocId) ? sessionDocId : undefined;

      let queryAnalysis: any;
      try {
        queryAnalysis = await queryAnalyzer.analyzeWithAI(validated.message);
      } catch (error) {
        logger.warn("Query analysis failed, using heuristic fallback", {
          sessionId: validated.sessionId,
          error: (error as Error).message,
        });
        queryAnalysis = await queryAnalyzer.analyze(validated.message);
      }
      const queryAnalysisMs = Date.now() - start;

      const retrievalStart = Date.now();
      let scoredCandidates: any[] = [];
      try {
        scoredCandidates = await (retriever as any).retrieve(
          queryAnalysis,
          scopeDocId,
          req.userId
        );
      } catch (error) {
        logger.error("Retrieval failed, continuing without memory injection", {
          sessionId: validated.sessionId,
          error: (error as Error).message,
        });
      }
      const retrievalMs = Date.now() - retrievalStart;

      const assemblyStart = Date.now();
      let assembly: any = null;
      try {
        assembly = assembler.assemble(scoredCandidates, queryAnalysis);
      } catch (error) {
        logger.warn("Context assembly failed, continuing without memory injection", {
          sessionId: validated.sessionId,
          error: (error as Error).message,
        });
      }

      const contextBlock = assembly?.contextBlock ?? {
        rawText: "",
        memories: [],
        totalCandidates: 0,
        budgetUsed: 0,
        budgetMax: 0,
      };
      const selectedMemories: any[] = Array.isArray(assembly?.selectedMemories)
        ? assembly.selectedMemories
        : [];
      const assemblyMs = Date.now() - assemblyStart;

      let rawTrace: any[] = [];
      try {
        rawTrace =
          (promptBuilder as any).buildMemoryTrace(contextBlock, selectedMemories) ??
          [];
      } catch (error) {
        logger.warn("Memory trace build failed", {
          sessionId: validated.sessionId,
          error: (error as Error).message,
        });
      }

      let memoryTrace: any[] = rawTrace;
      try {
        memoryTrace = await enrichMemoryTrace(rawTrace, req.userId);
      } catch (error) {
        logger.warn("Memory trace enrichment failed", {
          sessionId: validated.sessionId,
          error: (error as Error).message,
        });
      }

      const sourceDocuments = buildSourceDocuments(memoryTrace);
      const relatedDocuments = await getRelatedDocumentHints(
        req.userId,
        relationshipStore,
        scopeDocId,
        memoryTrace
      );
      const connectionConfidence = buildConnectionConfidence(
        scoredCandidates,
        memoryTrace
      );

      const promptPair = (promptBuilder as any).buildSystemContextPrompt(
        contextBlock,
        validated.message,
        knowledgeBase,
        queryAnalysis
      );
      const systemPrompt = promptPair?.systemPrompt ?? "";
      const userPrompt = promptPair?.userPrompt ?? validated.message;

      const modelStart = Date.now();
      let modelResult: any;
      try {
        modelResult = await modelRouter.send(
          systemPrompt,
          userPrompt,
          validated.modelId
        );
      } catch (error) {
        const failure = toModelFailurePayload(
          error as Error,
          config.server.isProduction
        );
        logger.error("AI chat provider failed", {
          sessionId: validated.sessionId,
          error: (error as Error).message,
        });
        res.status(failure.status).json(failure.body);
        return;
      }
      const modelMs = Date.now() - modelStart;

      const aiTimestamp = new Date().toISOString();
      const aiMessage = await rawStore.storeMessage(
        validated.sessionId,
        "assistant",
        modelResult.response,
        aiTimestamp
      );

      try {
        (ingestionPipeline as any).ingestMessageAsync(
          "user",
          validated.message,
          `chat:${validated.sessionId}`,
          validated.sessionId,
          timestamp,
          userMessageId,
          req.userId
        );
        (ingestionPipeline as any).ingestMessageAsync(
          "assistant",
          modelResult.response,
          `chat:${validated.sessionId}`,
          validated.sessionId,
          aiTimestamp,
          aiMessage,
          req.userId
        );
      } catch (error) {
        logger.warn("Async message ingestion failed", {
          sessionId: validated.sessionId,
          error: (error as Error).message,
        });
      }

      const traceByBucket = new Map<string, any>();
      for (const item of memoryTrace) {
        if (item?.bucketId && isValidUuid(item.bucketId)) {
          traceByBucket.set(item.bucketId, item);
        }
      }

      const injectedMemories = selectedMemories.map(
        (memory: any, index: number) =>
          toApiMemory(
            memory,
            traceByBucket.get(memory?.bucketId) ?? memoryTrace[index] ?? {},
            index + 1
          )
      );

      const injectedIds = injectedMemories
        .map((m: any) => m.bucketId)
        .filter(
          (id: unknown): id is string => typeof id === "string" && isValidUuid(id)
        );

      const injectedIdSet = new Set(injectedIds);
      const availableMemories = scoredCandidates
        .filter((candidate: any) => {
          const id = candidate?.bucketId;
          return (
            typeof id === "string" && isValidUuid(id) && !injectedIdSet.has(id)
          );
        })
        .slice(0, AVAILABLE_MEMORIES_LIMIT)
        .map((candidate: any, index: number) =>
          toApiMemory(candidate, {}, injectedMemories.length + index + 1)
        );

      if (injectedIds.length > 0) {
        try {
          await strengthTracker.onMultiAccess(injectedIds);
        } catch (error) {
          logger.warn("Strength tracking failed", {
            sessionId: validated.sessionId,
            error: (error as Error).message,
          });
        }
      }

      const totalDurationMs = Date.now() - start;

      res.status(200).json({
        message: {
          messageId: aiMessage,
          sessionId: validated.sessionId,
          role: "assistant",
          content: modelResult.response,
          timestamp: aiTimestamp,
        },
        injectedMemories,
        memoryTrace,
        sourceDocuments,
        relatedDocuments,
        connectionConfidence,
        availableMemories,
        totalMemories: nonNegativeInt(contextBlock.totalCandidates),
        knowledgeBase,
        queryAnalysis: {
          keyTerms: Array.isArray(queryAnalysis?.keyTerms)
            ? queryAnalysis.keyTerms
            : [],
          expandedTerms: Array.isArray(queryAnalysis?.expandedTerms)
            ? queryAnalysis.expandedTerms
            : [],
          intent: queryAnalysis?.intent ?? "recall",
          specificity: clampUnit(queryAnalysis?.specificity ?? 0),
          isAbstractQuery: Boolean(queryAnalysis?.isAbstractQuery ?? false),
          preferredTypes: Array.isArray(queryAnalysis?.preferredTypes)
            ? queryAnalysis.preferredTypes
            : [],
          documentScoped: Boolean(scopeDocId),
        },
        processingStats: {
          responseIngestion: null,
          context: {
            totalCandidates: nonNegativeInt(contextBlock.totalCandidates),
            budgetUsed: nonNegativeInt(contextBlock.budgetUsed),
            budgetMax: nonNegativeInt(contextBlock.budgetMax),
            queryAnalysisMs,
            retrievalTimeMs: retrievalMs,
            assemblyTimeMs: assemblyMs,
          },
          model: {
            modelUsed: modelResult.modelUsed,
            modelTimeMs: modelMs,
          },
          totalDurationMs,
        },
      });
    } catch (error) {
      const err = error as Error;
      logger.error("Chat endpoint failed", {
        sessionId: req.body?.sessionId,
        error: err.message,
        stack: err.stack,
      });
      res.status(500).json({ error: "Failed to process chat message" });
    }
  }
);

router.get(
  "/:sessionId/history",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (!req.userId || !isValidUuid(req.userId)) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }

      const { sessionId } = req.params;
      if (!sessionId || !isValidUuid(sessionId)) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const { sessionStore, rawStore } = getDependencies();

      const sessionExists = await sessionStore.exists(sessionId);
      if (!sessionExists) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const messages = await rawStore.getMessageHistory(sessionId);

      res.status(200).json({
        sessionId,
        messages,
        count: messages.length,
      });
    } catch (error) {
      logger.error("Chat history endpoint failed", {
        sessionId: req.params.sessionId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to retrieve chat history" });
    }
  }
);

export default router;