import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthContext } from "./AuthProvider";
import { ROUTES } from "../constants";
import { AuthLayout } from "../components/auth/AuthLayout";
import { AuthBrandScene } from "../components/auth/AuthBrandScene";
import { AuthFormPanel } from "../components/auth/AuthFormPanel";
import { AuthField } from "../components/auth/AuthField";
import { AuthPasswordField } from "../components/auth/AuthPasswordField";

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong", "Vault-grade"];

function scorePassword(password: string): number {
  let score = 0;

  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  return score;
}

export function SignupPage() {
  const { register, isAuthenticated, authenticating, error, clearError } =
    useAuthContext();

  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [terms, setTerms] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const score = scorePassword(password);

  const requirements = [
    {
      label: "8+ characters",
      ok: password.length >= 8,
    },
    {
      label: "Uppercase",
      ok: /[A-Z]/.test(password),
    },
    {
      label: "Lowercase",
      ok: /[a-z]/.test(password),
    },
    {
      label: "Number",
      ok: /[0-9]/.test(password),
    },
  ];

  const clearFieldError = (key: string) => {
    if (fieldErrors[key]) {
      setFieldErrors((current) => ({ ...current, [key]: "" }));
    }

    if (error) {
      clearError();
    }
  };

  const validate = () => {
    const next: Record<string, string> = {};

    if (displayName.trim().length < 2) {
      next.displayName = "Name must be at least 2 characters";
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Enter a valid email address";
    }

    if (password.length < 8) {
      next.password = "Password must be at least 8 characters";
    } else if (
      !/[A-Z]/.test(password) ||
      !/[a-z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      next.password = "Use uppercase, lowercase, and a number";
    }

    if (confirmPassword !== password) {
      next.confirmPassword = "Passwords do not match";
    }

    if (!terms) {
      next.terms = "You must accept the terms to continue";
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
      await register(email.trim(), password, displayName.trim());
      navigate(ROUTES.cortex, { replace: true });
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
              Start{" "}
              <em className="font-normal italic text-ember-hi">
                remembering
              </em>{" "}
              everything.
            </>
          }
          subtitle="One account. Every document, every conversation — distilled into a knowledge graph that strengthens with use and fades with neglect."
          chips={["7 concept types", "6 relationship edges", "1 living graph"]}
        />
      }
    >
      <AuthFormPanel
        kicker="Create account"
        title={
          <>
            Begin{" "}
            <em className="font-normal italic text-ember-hi">remembering.</em>
          </>
        }
        subtitle="Thirty seconds. Your future self says thanks."
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
            label="Name"
            type="text"
            autoComplete="name"
            placeholder="Ada Lovelace"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              clearFieldError("displayName");
            }}
            error={fieldErrors.displayName}
          />

          <AuthField
            label="Email"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="you@archive.dev"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              clearFieldError("email");
            }}
            error={fieldErrors.email}
          />

          <AuthPasswordField
            label="Password"
            autoComplete="new-password"
            placeholder="Create a strong password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              clearFieldError("password");
            }}
            error={fieldErrors.password}
          />

          {password.length > 0 && (
            <div className="fx-rise rounded-2xl border border-line bg-coal/50 p-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[8.5px] uppercase tracking-[0.22em] text-stone/60">
                  Strength
                </span>
                <span
                  className={`font-mono text-[9px] uppercase tracking-[0.18em] ${
                    score <= 2
                      ? "text-flare"
                      : score === 3
                        ? "text-ember-hi"
                        : "text-mineral"
                  }`}
                >
                  {STRENGTH_LABELS[score]}
                </span>
              </div>

              <div className="mt-2.5 flex gap-1.5">
                {[1, 2, 3, 4, 5].map((step) => (
                  <span
                    key={step}
                    className="h-1.5 flex-1 rounded-full"
                    style={{
                      background:
                        score >= step
                          ? score <= 2
                            ? "var(--flare)"
                            : score === 3
                              ? "var(--ember)"
                              : "var(--mineral)"
                          : "var(--bark)",
                    }}
                  />
                ))}
              </div>

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                {requirements.map((requirement) => (
                  <span
                    key={requirement.label}
                    className={`font-mono text-[8.5px] uppercase tracking-[0.16em] ${
                      requirement.ok ? "text-mineral" : "text-stone/50"
                    }`}
                  >
                    {requirement.ok ? "✓" : "•"} {requirement.label}
                  </span>
                ))}
              </div>
            </div>
          )}

          <AuthPasswordField
            label="Confirm password"
            autoComplete="new-password"
            placeholder="Repeat your password"
            value={confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              clearFieldError("confirmPassword");
            }}
            error={fieldErrors.confirmPassword}
          />

          <div className="field mb-0">
            <button
              type="button"
              className={`checkbox-row ${terms ? "checked" : ""}`}
              onClick={() => {
                setTerms((value) => !value);
                clearFieldError("terms");
              }}
              role="checkbox"
              aria-checked={terms}
            >
              <span className="checkbox">{terms ? "✓" : ""}</span>
              <span>I agree to the ContextOS Terms and Privacy Policy.</span>
            </button>

            {fieldErrors.terms && (
              <span className="field-error fx-rise mt-2">
                {fieldErrors.terms}
              </span>
            )}
          </div>

          <button
            type="submit"
            className="btn btn-primary h-[52px] w-full rounded-2xl text-[15px]"
            disabled={authenticating}
          >
            {authenticating ? (
              <span className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 animate-ping rounded-full bg-current" />
                Igniting your archive…
              </span>
            ) : (
              "Ignite my archive"
            )}
          </button>

          <div className="form-divider">Already here</div>

          <Link
            to={ROUTES.login}
            className="btn btn-ghost h-[48px] w-full rounded-2xl"
          >
            Sign in instead
          </Link>
        </form>
      </AuthFormPanel>
    </AuthLayout>
  );
}