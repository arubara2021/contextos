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

    // Shared sandbox has no expiry — always valid
    if (parsed.expiresAt === null) {
      return parsed;
    }

    // Timed sandbox — check expiry
    if (parsed.expiresAt && new Date(parsed.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(DEMO_STORAGE_KEY);
      localStorage.removeItem(DEMO_TOKEN_KEY);
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
      // Restore the saved token so API calls work
      if (stored.token) {
        setToken(stored.token, true);
      }
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
    localStorage.removeItem(DEMO_STORAGE_KEY);
    localStorage.removeItem(DEMO_TOKEN_KEY);
    clearToken();
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setState({ isDemo: false, expiresAt: null, remainingMs: 0, minting: false, error: null });
  }, []);

  // Countdown timer — only for timed sandboxes, not shared
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
      // Check if we already have a valid sandbox token
      const existingDemo = getStoredDemo();
      if (existingDemo?.token) {
        // Reuse existing sandbox — no API call needed
        setToken(existingDemo.token, true);
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
      }

      // No existing sandbox — request one from backend
      // Backend now returns the SAME shared user every time
      const data = await api.demo.startSandbox();

      setToken(data.token, true); // always persist to localStorage
      setStoredUser(data.user, true);

      // Store sandbox info + token for reuse
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
        remainingMs: data.expiresAt
          ? data.ttlMinutes * 60 * 1000
          : Infinity,
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