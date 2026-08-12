import { Router, Request, Response } from "express";
import { healthCheck, getPoolStats } from "../database";
import { getDependencies, initializeDependencies } from "./dependencies";
import config from "../config";
import logger from "../utils/logger";

const router = Router();

const AI_HEALTH_TTL_MS = 30000;
const AI_HEALTH_TIMEOUT_MS = 8000;
const STORAGE_TTL_MS = 60000;
const STORAGE_TIMEOUT_MS = 3000;

let aiHealthCache: {
  timestamp: number;
  data: any;
} | null = null;

let aiHealthRefresh: Promise<any> | null = null;

let storageCache: {
  timestamp: number;
  data: any;
} | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} timed out after ${ms}ms`));
      }, ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function getDepsSafe(): Promise<any | null> {
  try {
    return getDependencies();
  } catch {
    try {
      return initializeDependencies();
    } catch (error) {
      logger.warn("Dependencies unavailable for health route", {
        error: (error as Error).message,
      });

      return null;
    }
  }
}

function normalizeAiHealth(data: any): any {
  if (!data || typeof data !== "object") {
    return {
      status: "unhealthy",
      errors: ["AI health check returned empty result"],
      entries: [],
    };
  }

  const validStatuses = ["healthy", "degraded", "unhealthy"];

  let status = data.status;

  if (!validStatuses.includes(status)) {
    if (data.healthy === true) {
      status = "healthy";
    } else if (data.healthy === false) {
      status = "unhealthy";
    } else {
      status = "degraded";
    }
  }

  const errors = Array.isArray(data.errors)
    ? data.errors.filter((item: unknown): item is string => typeof item === "string")
    : [];

  const entries = Array.isArray(data.entries) ? data.entries : [];

  return {
    ...data,
    status,
    errors,
    entries,
  };
}

async function fetchAiHealth(deps: any): Promise<any> {
  if (!deps) {
    return {
      status: "unhealthy",
      errors: ["Dependencies unavailable"],
      entries: [],
    };
  }

  try {
    const healthTask = deps.checkAIHealth
      ? deps.checkAIHealth()
      : deps.modelRouter?.health
        ? deps.modelRouter.health()
        : Promise.resolve({
          status: "unhealthy",
          errors: ["No AI health method available"],
          entries: [],
        });

    const data = await withTimeout(
      Promise.resolve(healthTask),
      AI_HEALTH_TIMEOUT_MS,
      "AI health check"
    );

    return normalizeAiHealth(data);
  } catch (error) {
    logger.warn("AI health check failed", {
      error: (error as Error).message,
    });

    return {
      status: "unhealthy",
      errors: [(error as Error).message],
      entries: [],
    };
  }
}

async function getCachedAiHealth(forceRefresh: boolean): Promise<any> {
  const now = Date.now();

  if (
    !forceRefresh &&
    aiHealthCache &&
    now - aiHealthCache.timestamp < AI_HEALTH_TTL_MS
  ) {
    return aiHealthCache.data;
  }

  if (aiHealthRefresh) {
    return aiHealthRefresh;
  }

  const refreshTask = (async () => {
    const deps = await getDepsSafe();
    const data = await fetchAiHealth(deps);

    aiHealthCache = {
      timestamp: Date.now(),
      data,
    };

    return data;
  })();

  aiHealthRefresh = refreshTask;

  try {
    return await refreshTask;
  } finally {
    aiHealthRefresh = null;
  }
}

async function getStorageInfo(): Promise<any> {
  const now = Date.now();

  if (storageCache && now - storageCache.timestamp < STORAGE_TTL_MS) {
    return storageCache.data;
  }

  let data: any = {
    s3: {
      available: false,
      bucket: config.s3.bucketName,
    },
  };

  try {
    const deps = await getDepsSafe();

    if (deps?.s3Client?.isAvailable) {
      const available = await withTimeout(
        Promise.resolve(deps.s3Client.isAvailable()),
        STORAGE_TIMEOUT_MS,
        "S3 health check"
      );

      data = {
        s3: {
          available: Boolean(available),
          bucket: config.s3.bucketName,
        },
      };
    }
  } catch (error) {
    data = {
      s3: {
        available: false,
        bucket: config.s3.bucketName,
        error: (error as Error).message,
      },
    };
  }

  storageCache = {
    timestamp: Date.now(),
    data,
  };

  return data;
}

function wantsRefresh(req: Request): boolean {
  if (!config.server.isDevelopment) {
    return false;
  }

  const value = String(req.query.refresh ?? "").toLowerCase();

  return value === "1" || value === "true" || value === "yes";
}

router.get("/", async (req: Request, res: Response) => {
  const start = Date.now();

  const database = await healthCheck();

  let pool = null;

  try {
    pool = await getPoolStats();
  } catch (error) {
    pool = {
      error: (error as Error).message,
    };
  }

  const forceRefresh = wantsRefresh(req);
  const ai = await getCachedAiHealth(forceRefresh);
  const storage = await getStorageInfo();
  const deps = await getDepsSafe();

  const providerOrder = Array.isArray(ai?.providerOrder)
    ? ai.providerOrder
    : Array.isArray(deps?.providerOrder)
      ? deps.providerOrder
      : [];

  const overall = !database.healthy
    ? "unhealthy"
    : ai?.status === "unhealthy"
      ? "degraded"
      : "ok";

  res.status(database.healthy ? 200 : 503).json({
    status: overall,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    latencyMs: Date.now() - start,
    database,
    pool,
    ai: {
      ...ai,
      providerOrder,
      defaultProvider: config.ai.defaultProvider,
      fallbackProviders: config.ai.fallbackProviders,
      embeddingDimension: config.embedding.dimension,
      cachedAt: aiHealthCache
        ? new Date(aiHealthCache.timestamp).toISOString()
        : null,
    },
    storage,
  });
});

router.get("/live", async (_req: Request, res: Response) => {
  res.status(200).json({
    status: "alive",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

router.get("/ready", async (_req: Request, res: Response) => {
  const database = await healthCheck();
  const ai = await getCachedAiHealth(false);

  const ready = database.healthy && ai?.status !== "unhealthy";

  res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready",
    timestamp: new Date().toISOString(),
    database,
    ai,
  });
});

router.get("/providers", async (req: Request, res: Response) => {
  try {
    const forceRefresh = wantsRefresh(req);
    const deps = await getDepsSafe();
    const ai = await getCachedAiHealth(forceRefresh);

    const providerOrder = Array.isArray(ai?.providerOrder)
      ? ai.providerOrder
      : Array.isArray(deps?.providerOrder)
        ? deps.providerOrder
        : [];

    res.status(200).json({
      defaultProvider: config.ai.defaultProvider,
      fallbackProviders: config.ai.fallbackProviders,
      providerOrder,
      report: ai,
      cachedAt: aiHealthCache
        ? new Date(aiHealthCache.timestamp).toISOString()
        : null,
    });
  } catch (error) {
    logger.error("GET /health/providers failed", {
      error: (error as Error).message,
    });

    res.status(500).json({
      error: "Failed to retrieve AI provider health",
    });
  }
});

export default router;