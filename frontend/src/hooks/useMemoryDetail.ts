import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { MemoryDetailResponse } from "../types";

export function useMemoryDetail(bucketId: string | null) {
  const [detail, setDetail] = useState<MemoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!bucketId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.memories.get(bucketId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memory");
    } finally {
      setLoading(false);
    }
  }, [bucketId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { detail, loading, error, refetch };
}