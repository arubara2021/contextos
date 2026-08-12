import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { STORAGE_KEYS } from "../constants";
import type { Session } from "../types";

export function useSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEYS.lastSession)
  );

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const result = await api.sessions.list();
      setSessions(result.sessions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const select = useCallback((sessionId: string | null) => {
    setActiveSessionId(sessionId);
    if (sessionId) {
      localStorage.setItem(STORAGE_KEYS.lastSession, sessionId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.lastSession);
    }
  }, []);

  const create = useCallback(
    async (title?: string) => {
      const created = await api.sessions.create(title);
      const session: Session = {
        ...created,
        lastMessage: null,
        lastMessageRole: null,
        lastMessageAt: null,
      };
      setSessions((list) => [session, ...list]);
      select(session.sessionId);
      return session;
    },
    [select]
  );

  const rename = useCallback(async (sessionId: string, title: string) => {
    const updated = await api.sessions.update(sessionId, title);
    setSessions((list) =>
      list.map((s): Session =>
        s.sessionId === sessionId
          ? { ...s, title: updated.title, updatedAt: updated.updatedAt }
          : s
      )
    );
    return updated;
  }, []);

  const remove = useCallback(async (sessionId: string) => {
    await api.sessions.remove(sessionId);
    setSessions((list) => list.filter((s) => s.sessionId !== sessionId));
    setActiveSessionId((current) => {
      if (current === sessionId) {
        localStorage.removeItem(STORAGE_KEYS.lastSession);
        return null;
      }
      return current;
    });
  }, []);

  return {
    sessions,
    loading,
    error,
    activeSessionId,
    select,
    create,
    rename,
    remove,
    refetch,
  };
}