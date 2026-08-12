import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import type {
  ChatMessage,
  ChatResponse,
  InjectedMemory,
  KnowledgeBaseState,
  QueryAnalysis,
} from "../types";

interface UseChatOptions {
  initialSessionId?: string | null;
  onSessionCreated?: (sessionId: string) => void;
}

function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 0) {
      return "The archive is unreachable — the backend is offline or still booting.";
    }
    if (err.status === 401) {
      return "Session rejected — sign in again or check the dev bypass seed.";
    }
    return err.details ? `${err.message} — ${err.details}` : err.message;
  }
  return err instanceof Error ? err.message : fallback;
}

export function useChat(options: UseChatOptions = {}) {
  const [sessionId, setSessionId] = useState<string | null>(
    options.initialSessionId ?? null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reaching, setReaching] = useState(false);
  const [trace, setTrace] = useState<InjectedMemory[]>([]);
  const [available, setAvailable] = useState<InjectedMemory[]>([]);
  const [analysis, setAnalysis] = useState<QueryAnalysis | null>(null);
  const [stats, setStats] = useState<ChatResponse["processingStats"] | null>(null);
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBaseState | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sessionCreatedRef = useRef(options.onSessionCreated);
  const inFlightSessionRef = useRef<string | null>(null);
  sessionCreatedRef.current = options.onSessionCreated;

  useEffect(() => {
    setSessionId(options.initialSessionId ?? null);
  }, [options.initialSessionId]);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      setLoadingHistory(false);
      return;
    }
    if (inFlightSessionRef.current === sessionId) {
      setLoadingHistory(false);
      return;
    }

    let cancelled = false;
    setMessages([]);
    setLoadingHistory(true);

    api.chat
      .history(sessionId)
      .then((result) => {
        if (cancelled) return;
        if (inFlightSessionRef.current === sessionId) return;
        setMessages(
          result.messages.map((m) => ({
            messageId: m.messageId,
            sessionId,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          }))
        );
      })
      .catch((err) => {
        if (!cancelled) {
          setError(describeError(err, "Failed to load history"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const send = useCallback(
    async (content: string, modelId?: string): Promise<ChatResponse | null> => {
      const text = content.trim();
      if (!text || reaching) return null;

      setError(null);

      let targetSessionId = sessionId;
      try {
        if (!targetSessionId) {
          const session = await api.sessions.create();
          targetSessionId = session.sessionId;
          inFlightSessionRef.current = targetSessionId;
          setSessionId(targetSessionId);
          sessionCreatedRef.current?.(targetSessionId);
        } else {
          inFlightSessionRef.current = targetSessionId;
        }
      } catch (err) {
        setError(describeError(err, "Could not start a conversation"));
        return null;
      }

      const userMessage: ChatMessage = {
        messageId: `local-${Date.now()}`,
        sessionId: targetSessionId,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };

      setMessages((list) => [...list, userMessage]);
      setReaching(true);

      try {
        const response = await api.chat.send(text, targetSessionId, modelId);
        setMessages((list) => [...list, response.message]);
        setTrace(Array.isArray(response.injectedMemories) ? response.injectedMemories : []);
        setAvailable(Array.isArray(response.availableMemories) ? response.availableMemories : []);
        setAnalysis(response.queryAnalysis);
        setStats(response.processingStats);
        if (response.knowledgeBase) {
          setKnowledgeBase(response.knowledgeBase);
        }
        return response;
      } catch (err) {
        setError(describeError(err, "Message failed"));
        return null;
      } finally {
        inFlightSessionRef.current = null;
        setReaching(false);
      }
    },
    [sessionId, reaching]
  );

  const reset = useCallback(() => {
    inFlightSessionRef.current = null;
    setSessionId(null);
    setMessages([]);
    setTrace([]);
    setAvailable([]);
    setAnalysis(null);
    setStats(null);
    setKnowledgeBase(null);
    setError(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    sessionId,
    messages,
    reaching,
    trace,
    available,
    analysis,
    stats,
    knowledgeBase,
    loadingHistory,
    error,
    send,
    reset,
    clearError,
  };
}