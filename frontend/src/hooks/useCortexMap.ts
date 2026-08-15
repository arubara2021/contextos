import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { CortexMapResponse } from "../api";

export function useCortexMap() {
    const [data, setData] = useState<CortexMapResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refetch = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const result = await api.cortex.map();
            setData(result);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load Cortex map");
            setData(null);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void refetch();
    }, [refetch]);

    return {
        data,
        loading,
        error,
        refetch,
    };
}
