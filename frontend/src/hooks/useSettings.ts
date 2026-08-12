import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Settings, SettingsUpdateParams } from "../types";

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSettings(await api.settings.get());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const update = useCallback(
    async (params: SettingsUpdateParams) => {
      setSaving(true);
      setError(null);
      try {
        await api.settings.update(params);
        await refetch();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save settings");
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [refetch]
  );

  return { settings, loading, saving, error, refetch, update };
}