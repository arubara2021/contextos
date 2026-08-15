import { useCallback, useEffect, useRef, useState } from "react";
import { api, setToken, setStoredUser, clearToken } from "../api";

const DEMO_STORAGE_KEY = "contextos.demo";
const DEMO_TOKEN_KEY = "contextos.demo.token";

interface DemoState {
  isDemo: boolean;
  expiresAt: string | null;
  remainingMs: number;
  minting: boolean;
  error: string | null;
}

interface StoredDemo {
  expiresAt: string | null;
  userId: string;
  token: string;
}

function getStoredDemo(): StoredDemo | null {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDemo;
    if (!parsed.token) return null;
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      clearDemoStorage();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function clearDemoStorage(): void {
  localStorage.removeItem(DEMO_STORAGE_KEY);
  localStorage.removeItem(DEMO_TOKEN_KEY);
  clearToken();
}

export function useDemo() {
  const [state, setState] = useState<DemoState>(() => {
    const stored = getStoredDemo();
    if (stored) {
      setToken(stored.token, true);
      return {
        isDemo: true,
        expiresAt: stored.expiresAt,
        remainingMs: stored.expiresAt
          ? Math.max(0, new Date(stored.expiresAt).getTime() - Date.now())
          : Infinity,
        minting: false,
        error: null,
      };
    }
    return { isDemo: false, expiresAt: null, remainingMs: 0, minting: false, error: null };
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearDemo = useCallback(() => {
    clearDemoStorage();
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState({ isDemo: false, expiresAt: null, remainingMs: 0, minting: false, error: null });
  }, []);

  // Validate cached token once on mount. If the user was deleted or the
  // JWT secret changed, self-heal instead of bouncing to the login page.
  useEffect(() => {
    if (!state.isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        await api.auth.me();
      } catch {
        if (!cancelled) clearDemo();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [state.isDemo, clearDemo]);

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
      const existingDemo = getStoredDemo();
      if (existingDemo?.token) {
        setToken(existingDemo.token, true);
        try {
          await api.auth.me(); // is this token still alive?
          setState({
            isDemo: true,
            expiresAt: existingDemo.expiresAt,
            remainingMs: existingDemo.expiresAt
              ? Math.max(0, new Date(existingDemo.expiresAt).getTime() - Date.now())
              : Infinity,
            minting: false,
            error: null,
          });
          return true;
        } catch {
          clearDemoStorage(); // dead token → mint a fresh one below
        }
      }

      const data = await api.demo.startSandbox();
      setToken(data.token, true);
      setStoredUser(data.user, true);

      const demoInfo: StoredDemo = {
        expiresAt: data.expiresAt,
        userId: data.user.userId,
        token: data.token,
      };
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(demoInfo));
      localStorage.setItem(DEMO_TOKEN_KEY, data.token);

      setState({
        isDemo: true,
        expiresAt: data.expiresAt,
        remainingMs: data.expiresAt ? data.ttlMinutes * 60 * 1000 : Infinity,
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
    if (!state.expiresAt) return "∞";
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
    isDemoActive: state.isDemo && (state.remainingMs > 0 || !state.expiresAt),
  };
}