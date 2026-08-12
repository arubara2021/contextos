import { Navigate, Outlet } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";

import { Logo } from "../components/shared/Logo";

export function ProtectedRoute() {
  const { isAuthenticated, initializing } = useAuthContext();


  if (initializing) {
    return (
      <div className="relative flex h-[100dvh] items-center justify-center overflow-hidden bg-void">
        <div className="pointer-events-none absolute inset-0 bg-ember-radial opacity-80" />
        <div className="pointer-events-none absolute inset-0 opacity-60" style={{
          background:
            "radial-gradient(620px 420px at 18% 18%, rgb(143 216 210 / 0.05), transparent 62%), radial-gradient(520px 360px at 82% 78%, rgb(255 138 61 / 0.08), transparent 58%)",
        }} />

        <div className="fx-rise relative flex flex-col items-center gap-6 px-6 text-center">
          <div className="relative">
            <span className="fx-pulse-ring absolute inset-0 rounded-full text-ember" />
            <div className="fx-breathe">
              <Logo size={56} animated />
            </div>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-stone">
              Opening the archive
            </p>
            <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.18em] text-stone/50">
              Verifying session
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}