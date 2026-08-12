import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";
import { ROUTES } from "../constants";
import { AuthLayout } from "../components/auth/AuthLayout";
import { AuthBrandScene } from "../components/auth/AuthBrandScene";
import { AuthFormPanel } from "../components/auth/AuthFormPanel";
import { AuthField } from "../components/auth/AuthField";
import { AuthPasswordField } from "../components/auth/AuthPasswordField";

export function LoginPage() {
  const { login, isAuthenticated, authenticating, error, clearError } =
    useAuthContext();

  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{
    email?: string;
    password?: string;
  }>({});

  const from = (location.state as { from?: string } | null)?.from ?? ROUTES.dive;

  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  const validate = () => {
    const next: {
      email?: string;
      password?: string;
    } = {};

    const normalizedEmail = email.trim();

    if (!normalizedEmail) {
      next.email = "Email is required";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      next.email = "Enter a valid email address";
    }

    if (!password) {
      next.password = "Password is required";
    }

    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    clearError();

    if (!validate()) {
      return;
    }

    try {
      await login(email.trim(), password);
      navigate(from, { replace: true });
    } catch {
      return;
    }
  };

  if (isAuthenticated) {
    return null;
  }

  return (
    <AuthLayout
      brand={
        <AuthBrandScene
          kicker="Persistent memory for AI"
          title={
            <>
              Memories that don't{" "}
              <em className="font-normal italic text-ember-hi">fade.</em>
            </>
          }
          subtitle="Documents and conversations become living knowledge — extracted once, retrieved forever, and honest about what is slipping away."
          chips={["Extract once", "Retrieve forever", "Decay honestly"]}
        />
      }
    >
      <AuthFormPanel
        kicker="Sign in"
        title={
          <>
            Welcome <em className="font-normal italic text-ember-hi">back.</em>
          </>
        }
        subtitle="Your archive kept everything. It waited."
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5" noValidate>
          {error && (
            <div
              className="fx-rise rounded-2xl border border-flare/40 bg-flare/10 px-4 py-3 text-[13px] text-flare"
              role="alert"
            >
              {error}
            </div>
          )}

          <AuthField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@archive.dev"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);

              if (fieldErrors.email) {
                setFieldErrors((current) => ({ ...current, email: undefined }));
              }

              if (error) {
                clearError();
              }
            }}
            error={fieldErrors.email}
          />

          <AuthPasswordField
            label="Password"
            autoComplete="current-password"
            placeholder="••••••••••"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);

              if (fieldErrors.password) {
                setFieldErrors((current) => ({
                  ...current,
                  password: undefined,
                }));
              }

              if (error) {
                clearError();
              }
            }}
            error={fieldErrors.password}
          />

          <button
            type="submit"
            className="btn btn-primary h-[52px] w-full rounded-2xl text-[15px]"
            disabled={authenticating}
          >
            {authenticating ? (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-current" />
                Opening the archive…
              </span>
            ) : (
              "Enter the archive"
            )}
          </button>

          <div className="form-divider">New here</div>

          <Link
            to={ROUTES.signup}
            className="btn btn-ghost h-[48px] w-full rounded-2xl"
          >
            Create an account
          </Link>
        </form>
      </AuthFormPanel>
    </AuthLayout>
  );
}