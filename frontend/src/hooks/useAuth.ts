import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  clearToken,
  getStoredUser,
  getToken,
  isTokenExpired,
  setStoredUser,
  setToken,
  UNAUTHORIZED_EVENT,
} from "../api";
import type { User } from "../types";

const DEV_BYPASS_AUTH = import.meta.env.VITE_DEV_BYPASS === "true";
const DEV_TOKEN = "dev-bypass-token";
const DEV_USER: User = {
  userId: "dev-user-00000000-0000-0000-0000-000000000000",
  email: "demo@contextos.local",
  displayName: "Vera Lindqvist",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const DEMO_STORAGE_KEY = "contextos.demo";
const DEMO_TOKEN_KEY = "contextos.demo.token";

if (DEV_BYPASS_AUTH) {
  setToken(DEV_TOKEN);
  setStoredUser(DEV_USER);
}

interface AuthState {
  user: User | null;
  token: string | null;
  initializing: boolean;
  authenticating: boolean;
  error: string | null;
}

interface SandboxMint {
  token: string;
  user: User;
  expiresAt: string | null;
  ttlMinutes: number;
}

const EMPTY_STATE: AuthState = {
  user: null,
  token: null,
  initializing: false,
  authenticating: false,
  error: null,
};

function getDemoToken(): string | null {
  try {
    return localStorage.getItem(DEMO_TOKEN_KEY);
  } catch {
    return null;
  }
}

function getDemoExpiry(): number | null {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt?: string | null };
    if (!parsed.expiresAt) return null;
    const time = new Date(parsed.expiresAt).getTime();
    return Number.isFinite(time) ? time : null;
  } catch {
    return null;
  }
}

function hasDemoMarker(): boolean {
  return getDemoToken() !== null;
}

function isSandboxSession(): boolean {
  const demoToken = getDemoToken();
  if (!demoToken) return false;
  const expiry = getDemoExpiry();
  if (expiry !== null && expiry <= Date.now()) return false;
  return true;
}

function clearDemoStorage(): void {
  try {
    localStorage.removeItem(DEMO_STORAGE_KEY);
    localStorage.removeItem(DEMO_TOKEN_KEY);
  } catch {
    return;
  }
}

function persistSandboxMint(data: SandboxMint): void {
  setToken(data.token, true);
  setStoredUser(data.user, true);
  try {
    localStorage.setItem(
      DEMO_STORAGE_KEY,
      JSON.stringify({
        expiresAt: data.expiresAt,
        userId: data.user.userId,
        token: data.token,
      })
    );
    localStorage.setItem(DEMO_TOKEN_KEY, data.token);
  } catch {
    return;
  }
}

function createInitialState(): AuthState {
  if (DEV_BYPASS_AUTH) {
    return {
      user: DEV_USER,
      token: DEV_TOKEN,
      initializing: false,
      authenticating: false,
      error: null,
    };
  }
  const storedToken = getToken();
  if (storedToken && storedToken === DEV_TOKEN) {
    clearToken();
  }
  const token = getToken();
  const sandbox = isSandboxSession();
  if (sandbox) {
    const user = getStoredUser();
    const demoToken = getDemoToken();
    if (demoToken && demoToken !== token) {
      setToken(demoToken, true);
    }
    return {
      user,
      token: demoToken ?? token,
      initializing: true,
      authenticating: false,
      error: null,
    };
  }
  const expired = !token || isTokenExpired();
  return {
    user: expired ? null : getStoredUser(),
    token: expired ? null : token,
    initializing: !expired && Boolean(token),
    authenticating: false,
    error: null,
  };
}

export function useAuth() {
  const [state, setState] = useState<AuthState>(createInitialState);

  useEffect(() => {
    if (DEV_BYPASS_AUTH) {
      return;
    }
    let cancelled = false;

    const healSandbox = () =>
      api.demo
        .startSandbox()
        .then((data) => {
          if (cancelled) return;
          persistSandboxMint(data);
          setState((current) => ({
            ...current,
            user: data.user,
            token: data.token,
            initializing: false,
            authenticating: false,
            error: null,
          }));
        })
        .catch(() => {
          if (cancelled) return;
          setState((current) => ({ ...current, initializing: false }));
        });

    const onUnauthorized = () => {
      if (cancelled) return;
      if (isSandboxSession() || hasDemoMarker()) {
        void healSandbox();
        return;
      }
      setState({ ...EMPTY_STATE });
    };

    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);

    const sandbox = isSandboxSession();
    const token = getToken();
    if (!sandbox && !hasDemoMarker() && (!token || isTokenExpired())) {
      clearToken();
      setState({ ...EMPTY_STATE });
      return () => {
        window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      };
    }

    const heal =
      sandbox && (!token || isTokenExpired())
        ? api.demo
          .startSandbox()
          .then((data) => {
            if (!cancelled) persistSandboxMint(data);
          })
          .catch(() => undefined)
        : Promise.resolve();

    heal
      .then(() => api.auth.me())
      .then(({ user }) => {
        if (cancelled) return;
        setStoredUser(user);
        setState((current) => ({
          ...current,
          user,
          token: getToken(),
          initializing: false,
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        const is401 = err instanceof ApiError && err.status === 401;
        const isUserDeleted = err instanceof ApiError && err.status === 404;
        if (isSandboxSession() || hasDemoMarker()) {
          void api.demo
            .startSandbox()
            .then((data) => {
              if (cancelled) return;
              persistSandboxMint(data);
              return api.auth.me().then(({ user: healedUser }) => {
                if (cancelled) return;
                setStoredUser(healedUser);
                setState((current) => ({
                  ...current,
                  user: healedUser,
                  token: getToken(),
                  initializing: false,
                  error: null,
                }));
              });
            })
            .catch(() => {
              if (cancelled) return;
              setState((current) => ({
                ...current,
                initializing: false,
                error: null,
              }));
            });
          return;
        }
        if (is401 || isUserDeleted) {
          clearToken();
          setState({ ...EMPTY_STATE });
        } else {
          setState((current) => ({
            ...current,
            initializing: false,
            error: null,
          }));
        }
      });

    return () => {
      cancelled = true;
      window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string, remember = true) => {
      if (DEV_BYPASS_AUTH) {
        setToken(DEV_TOKEN);
        setStoredUser(DEV_USER);
        setState((current) => ({
          ...current,
          user: DEV_USER,
          token: DEV_TOKEN,
          authenticating: false,
          error: null,
        }));
        return DEV_USER;
      }
      setState((current) => ({
        ...current,
        authenticating: true,
        error: null,
      }));
      try {
        const normalizedEmail = email.trim().toLowerCase();
        const { user, token } = await api.auth.login(normalizedEmail, password);
        clearDemoStorage();
        setToken(token, remember);
        setStoredUser(user, remember);
        setState((current) => ({
          ...current,
          user,
          token,
          authenticating: false,
          error: null,
        }));
        return user;
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.status === 429
              ? "Too many attempts. Please wait and try again."
              : error.message
            : "Login failed";
        setState((current) => ({
          ...current,
          authenticating: false,
          error: message,
        }));
        throw error;
      }
    },
    []
  );

  const register = useCallback(
    async (email: string, password: string, displayName: string) => {
      if (DEV_BYPASS_AUTH) {
        const user = {
          ...DEV_USER,
          displayName: displayName.trim() || DEV_USER.displayName,
          email: email.trim().toLowerCase(),
        };
        setToken(DEV_TOKEN);
        setStoredUser(user);
        setState((current) => ({
          ...current,
          user,
          token: DEV_TOKEN,
          authenticating: false,
          error: null,
        }));
        return user;
      }
      setState((current) => ({
        ...current,
        authenticating: true,
        error: null,
      }));
      try {
        const normalizedEmail = email.trim().toLowerCase();
        const { user, token } = await api.auth.register(
          normalizedEmail,
          password,
          displayName.trim()
        );
        clearDemoStorage();
        setToken(token, true);
        setStoredUser(user, true);
        setState((current) => ({
          ...current,
          user,
          token,
          authenticating: false,
          error: null,
        }));
        return user;
      } catch (error) {
        const message =
          error instanceof ApiError
            ? error.status === 429
              ? "Too many attempts. Please wait and try again."
              : error.message
            : "Registration failed";
        setState((current) => ({
          ...current,
          authenticating: false,
          error: message,
        }));
        throw error;
      }
    },
    []
  );

  const logout = useCallback(() => {
    if (DEV_BYPASS_AUTH) return;
    clearDemoStorage();
    clearToken();
    setState({ ...EMPTY_STATE });
  }, []);

  const updateProfile = useCallback(
    async (params: { email?: string; displayName?: string }) => {
      if (DEV_BYPASS_AUTH) {
        const user = { ...DEV_USER, ...params } as User;
        setStoredUser(user);
        setState((current) => ({ ...current, user }));
        return user;
      }
      const { user } = await api.auth.updateMe(params);
      setStoredUser(user);
      setState((current) => ({ ...current, user }));
      return user;
    },
    []
  );

  const updatePassword = useCallback(
    (currentPassword: string, newPassword: string) => {
      if (DEV_BYPASS_AUTH) {
        return Promise.resolve({ message: "Password updated (dev mode)" });
      }
      return api.auth.updatePassword(currentPassword, newPassword);
    },
    []
  );

  const clearError = useCallback(() => {
    setState((current) => ({ ...current, error: null }));
  }, []);

  return {
    ...state,
    isAuthenticated: Boolean(state.token && state.user),
    login,
    register,
    logout,
    updateProfile,
    updatePassword,
    clearError,
  };
}