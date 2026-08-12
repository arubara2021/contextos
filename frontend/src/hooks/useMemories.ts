import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useDebounce } from "./useDebounce";
import type {
  ConceptType,
  MemoryFilters,
  MemoryListResponse,
  MemorySummary,
  MemoryUpdateParams,
} from "../types";

export function useMemories(initialFilters: MemoryFilters = {}) {
  const [filters, setFilters] = useState<MemoryFilters>({
    limit: 200,
    ...initialFilters,
  });
  const [data, setData] = useState<MemoryListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debouncedSearch = useDebounce(filters.search, 250);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await api.memories.list({ ...filters, search: debouncedSearch }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, [filters, debouncedSearch]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const setType = useCallback(
    (type?: ConceptType) => setFilters((f) => ({ ...f, type })),
    []
  );

  const setSearch = useCallback(
    (search?: string) => setFilters((f) => ({ ...f, search })),
    []
  );

  const setStrengthRange = useCallback(
    (minStrength?: number, maxStrength?: number) =>
      setFilters((f) => ({ ...f, minStrength, maxStrength })),
    []
  );

  const update = useCallback(
    async (bucketId: string, params: MemoryUpdateParams) => {
      await api.memories.update(bucketId, params);
      setData((d) =>
        d
          ? {
              ...d,
              memories: d.memories.map((m): MemorySummary =>
                m.bucketId === bucketId
                  ? {
                      ...m,
                      canonical: params.canonical ?? m.canonical,
                      importance: params.importance ?? m.importance,
                      conceptType: params.conceptType ?? m.conceptType,
                    }
                  : m
              ),
            }
          : d
      );
    },
    []
  );

  const remove = useCallback(async (bucketId: string) => {
    await api.memories.remove(bucketId);
    setData((d) =>
      d
        ? {
            ...d,
            memories: d.memories.filter((m) => m.bucketId !== bucketId),
            total: Math.max(0, d.total - 1),
          }
        : d
    );
  }, []);

  return {
    memories: data?.memories ?? [],
    total: data?.total ?? 0,
    filters,
    loading,
    error,
    refetch,
    setType,
    setSearch,
    setStrengthRange,
    update,
    remove,
  };
}