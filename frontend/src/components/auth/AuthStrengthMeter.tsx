import { useMemo } from "react";

interface AuthStrengthMeterProps {
  password: string;
  showRequirements?: boolean;
  className?: string;
}

const LABELS = ["", "Weak", "Fair", "Good", "Strong", "Vault-grade"];

function scorePassword(password: string): number {
  let score = 0;

  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  return score;
}

function toneForScore(score: number): "weak" | "fair" | "strong" {
  if (score <= 2) return "weak";
  if (score === 3) return "fair";
  return "strong";
}

export function AuthStrengthMeter({
  password,
  showRequirements = true,
  className = "",
}: AuthStrengthMeterProps) {
  const score = useMemo(() => scorePassword(password), [password]);
  const tone = toneForScore(score);
  const label = password.length > 0 ? LABELS[score] : "Idle";
  const percent = password.length > 0 ? Math.max(8, (score / 5) * 100) : 0;

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

  return (
    <div className={`auth-strength ${className}`} aria-live="polite">
      <div className="auth-strength-head">
        <span className="auth-strength-label">Memory-grade strength</span>
        <span className="auth-strength-value" data-tone={tone}>
          {label}
        </span>
      </div>

      <div
        className="auth-strength-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
        aria-label="Password strength"
      >
        <div
          className="auth-strength-fill"
          data-tone={tone}
          style={{ width: `${percent}%` }}
        />
      </div>

      {showRequirements && (
        <div className="auth-requirements">
          {requirements.map((requirement) => (
            <span
              key={requirement.label}
              className={`auth-requirement ${requirement.ok ? "ok" : ""}`}
            >
              <span className="auth-requirement-dot" />
              {requirement.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}