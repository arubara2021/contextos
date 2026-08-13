import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { LoginPage } from "./auth/LoginPage";
import { SignupPage } from "./auth/SignupPage";
import { ShellLayout } from "./components/layout/ShellLayout";
import { CortexPage } from "./pages/CortexPage";
import { DivePage } from "./pages/DivePage";
import { ArchivePage } from "./pages/ArchivePage";
import { SettingsPage } from "./pages/SettingsPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { LandingPage } from "./pages/LandingPage";
import { ROUTES } from "./constants";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path={ROUTES.login} element={<LoginPage />} />
          <Route path={ROUTES.signup} element={<SignupPage />} />
          <Route element={<ProtectedRoute />}>
            <Route element={<ShellLayout />}>
              <Route path={ROUTES.cortex} element={<CortexPage />} />
              <Route path={ROUTES.dive} element={<DivePage />} />
              <Route path={`${ROUTES.dive}/:sessionId`} element={<DivePage />} />
              <Route path={ROUTES.archive} element={<ArchivePage />} />
              <Route path={ROUTES.settings} element={<SettingsPage />} />
              <Route path={ROUTES.onboarding} element={<OnboardingPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}