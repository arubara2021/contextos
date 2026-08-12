import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { STATS_REFRESH_INTERVAL_MS } from "../constants";
import type { MemoryStats } from "../types";

interface StatsSubscriber {
  apply: (stats: MemoryStats) => void;
  setLoading: (value: boolean) => void;
  setError: (value: string | null) => void;
}

const COALESCE_MS = 120;

let subscribers = new Set<StatsSubscriber>();
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

async function fetchStats(): Promise<MemoryStats> {
  return api.memories.stats();
}

async function runSharedRefresh(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const stats = await fetchStats();
      for (const sub of subscribers) {
        sub.apply(stats);
        sub.setError(null);
        sub.setLoading(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load stats";
      for (const sub of subscribers) {
        sub.setError(message);
        sub.setLoading(false);
      }
    }
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

function ensureRunning(): void {
  if (!intervalTimer) {
    intervalTimer = window.setInterval(
      () => void runSharedRefresh(),
      STATS_REFRESH_INTERVAL_MS
    );
  }
  if (!coalesceTimer) {
    coalesceTimer = window.setTimeout(() => {
      coalesceTimer = null;
      void runSharedRefresh();
    }, COALESCE_MS);
  }
}

function stopIfEmpty(): void {
  if (subscribers.size > 0) return;
  if (intervalTimer) {
    window.clearInterval(intervalTimer);
    intervalTimer = null;
  }
  if (coalesceTimer) {
    window.clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
}

function subscribe(sub: StatsSubscriber): () => void {
  subscribers.add(sub);
  sub.setLoading(true);
  ensureRunning();
  return () => {
    subscribers.delete(sub);
    stopIfEmpty();
  };
}

export function useStats(autoRefresh = true) {
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!autoRefresh) {
      let cancelled = false;
      setLoading(true);
      setError(null);
      fetchStats()
        .then((result) => {
          if (!cancelled) setStats(result);
        })
        .catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load stats");
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    const sub: StatsSubscriber = {
      apply: setStats,
      setLoading,
      setError,
    };
    return subscribe(sub);
  }, [autoRefresh]);

  const refetch = useCallback(async () => {
    setError(null);
    if (autoRefresh) {
      setLoading(true);
      await runSharedRefresh();
      return;
    }
    setLoading(true);
    try {
      setStats(await fetchStats());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stats");
    } finally {
      setLoading(false);
    }
  }, [autoRefresh]);

  return { stats, loading, error, refetch };
}