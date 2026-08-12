import type { AIProvider, AITask, AIHealthResult } from "./ai-provider";
import type {
  ProviderHealthEntry,
  ProviderHealthReport,
} from "../types/ai-providers.types";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Health check timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkProviderHealth(
  providers: Record<string, AIProvider>,
  options?: {
    names?: string[];
    task?: AITask;
    timeoutMs?: number;
  }
): Promise<ProviderHealthReport> {
  const start = Date.now();
  const timeoutMs = options?.timeoutMs ?? 15000;
  const names = options?.names ?? Object.keys(providers);

  const entries: ProviderHealthEntry[] = [];

  const results = await Promise.allSettled(
    names.map(async (name) => {
      const provider = providers[name];

      if (!provider) {
        return {
          name,
          healthy: false,
          latencyMs: 0,
          error: "Provider not registered",
        } as ProviderHealthEntry;
      }

      const entryStart = Date.now();

      try {
        const result: AIHealthResult = await withTimeout(
          provider.healthCheck({ task: options?.task }),
          timeoutMs
        );

        return {
          name,
          healthy: result.healthy,
          latencyMs: result.latencyMs ?? Date.now() - entryStart,
          error: result.error,
          modelUsed:
            typeof result.details?.modelUsed === "string"
              ? result.details.modelUsed
              : undefined,
        } as ProviderHealthEntry;
      } catch (error) {
        return {
          name,
          healthy: false,
          latencyMs: Date.now() - entryStart,
          error: (error as Error).message,
        } as ProviderHealthEntry;
      }
    })
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      entries.push(result.value);
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const healthyCount = entries.filter((entry) => entry.healthy).length;

  let status: ProviderHealthReport["status"] = "unhealthy";

  if (entries.length > 0 && healthyCount === entries.length) {
    status = "healthy";
  } else if (healthyCount > 0) {
    status = "degraded";
  }

  const errors = entries
    .filter((entry) => !entry.healthy && entry.error)
    .map((entry) => `${entry.name}: ${entry.error}`);

  return {
    status,
    checked: entries.length,
    healthy: healthyCount,
    latencyMs: Date.now() - start,
    entries,
    errors,
  };
}