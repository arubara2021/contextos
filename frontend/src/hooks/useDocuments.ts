import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { DocumentListResponse, UploadAccepted } from "../types";

export function useDocuments() {
  const [data, setData] = useState<DocumentListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      setData(await api.documents.list());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load documents");
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    refetch().finally(() => setLoading(false));
  }, [refetch]);

  const upload = useCallback(
    async (file: File, sessionId?: string): Promise<UploadAccepted> => {
      setUploading(true);
      setError(null);
      try {
        return await api.documents.upload(file, sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        throw err;
      } finally {
        setUploading(false);
      }
    },
    []
  );

  const remove = useCallback(async (documentId: string) => {
    await api.documents.remove(documentId);
    setData((d) =>
      d
        ? {
            ...d,
            documents: d.documents.filter((doc) => doc.documentId !== documentId),
            count: Math.max(0, d.count - 1),
          }
        : d
    );
  }, []);

  return {
    documents: data?.documents ?? [],
    storage: data?.storage ?? null,
    count: data?.count ?? 0,
    loading,
    uploading,
    error,
    refetch,
    upload,
    remove,
  };
}