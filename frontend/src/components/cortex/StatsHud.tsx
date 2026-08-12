import { useStats } from "../../hooks/useStats";
import type { MemoryStats } from "../../types";

export function useStatsHud(): {
  stats: MemoryStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  return useStats();
}

export function StatsHud() {
  useStats();

  return null;
}