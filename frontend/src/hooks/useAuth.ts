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
  if (storedToken && storedToken === "dev-bypass-token") {
    clearToken();
  }

  const token = getToken();
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

    const onUnauthorized = () => {
      if (!cancelled) {
        setState({
          user: null,
          token: null,
          initializing: false,
          authenticating: false,
          error: null,
        });
      }
    };

    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);

    if (!getToken() || isTokenExpired()) {
      clearToken();
      setState({
        user: null,
        token: null,
        initializing: false,
        authenticating: false,
        error: null,
      });
      return () => {
        window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
      };
    }

    api.auth
      .me()
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

        // ONLY clear token if it's a hard 401 Unauthorized.
        // If it's a network timeout, Vercel cold start, or 500 error, keep the token 
        // so the user isn't forcefully logged out when clicking the back button.
        const is401 = err instanceof ApiError && err.status === 401;

        if (is401) {
          clearToken();
          setState({
            user: null,
            token: null,
            initializing: false,
            authenticating: false,
            error: null,
          });
        } else {
          // Keep session alive despite backend hiccup
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
    clearToken();
    setState({
      user: null,
      token: null,
      initializing: false,
      authenticating: false,
      error: null,
    });
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