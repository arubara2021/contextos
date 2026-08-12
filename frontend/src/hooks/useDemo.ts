import { useCallback, useEffect, useRef, useState } from "react";
import { api, setToken, setStoredUser, clearToken } from "../api";

const DEMO_STORAGE_KEY = "contextos.demo";

interface DemoState {
  isDemo: boolean;
  expiresAt: string | null;
  remainingMs: number;
  minting: boolean;
  error: string | null;
}

interface StoredDemo {
  expiresAt: string;
  userId: string;
}

function getStoredDemo(): StoredDemo | null {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDemo;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(DEMO_STORAGE_KEY);
      clearToken();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function useDemo() {
  const [state, setState] = useState<DemoState>(() => {
    const stored = getStoredDemo();
    if (stored) {
      return {
        isDemo: true,
        expiresAt: stored.expiresAt,
        remainingMs: Math.max(0, new Date(stored.expiresAt).getTime() - Date.now()),
        minting: false,
        error: null,
      };
    }
    return { isDemo: false, expiresAt: null, remainingMs: 0, minting: false, error: null };
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearDemo = useCallback(() => {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    clearToken();
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState({ isDemo: false, expiresAt: null, remainingMs: 0, minting: false, error: null });
  }, []);

  useEffect(() => {
    if (!state.isDemo || !state.expiresAt) return;

    const tick = () => {
      const remaining = new Date(state.expiresAt!).getTime() - Date.now();
      if (remaining <= 0) {
        clearDemo();
        window.location.href = "/";
        return;
      }
      setState((s) => ({ ...s, remainingMs: remaining }));
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [state.isDemo, state.expiresAt, clearDemo]);

  const launchSandbox = useCallback(async (): Promise<boolean> => {
    setState((s) => ({ ...s, minting: true, error: null }));

    try {
      const data = await api.demo.startSandbox();

      setToken(data.token);
      setStoredUser(data.user);
      localStorage.setItem(
        DEMO_STORAGE_KEY,
        JSON.stringify({ expiresAt: data.expiresAt, userId: data.user.userId })
      );

      setState({
        isDemo: true,
        expiresAt: data.expiresAt,
        remainingMs: data.ttlMinutes * 60 * 1000,
        minting: false,
        error: null,
      });

      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to launch sandbox";
      setState((s) => ({ ...s, minting: false, error: message }));
      return false;
    }
  }, []);

  const formattedRemaining = (() => {
    const totalSec = Math.floor(state.remainingMs / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  })();

  return {
    ...state,
    formattedRemaining,
    launchSandbox,
    clearDemo,
    isDemoActive: state.isDemo && state.remainingMs > 0,
  };
}