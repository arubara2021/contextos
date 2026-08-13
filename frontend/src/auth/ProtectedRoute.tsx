import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";
import { ROUTES } from "../constants";
import { getToken, isTokenExpired } from "../api";

export function ProtectedRoute() {
  const { isAuthenticated, initializing } = useAuthContext();
  const location = useLocation();

  const token = getToken();
  const hasUsableToken = Boolean(token) && !isTokenExpired();

  const restoring = (
    <div className="flex h-[100dvh] items-center justify-center bg-void">
      <div className="flex flex-col items-center gap-4">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-ember/30 border-t-ember" />
        <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-stone">
          Restoring session…
        </p>
      </div>
    </div>
  );

  if (initializing) {
    return restoring;
  }

  if (!isAuthenticated && hasUsableToken) {
    return restoring;
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.login} state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}