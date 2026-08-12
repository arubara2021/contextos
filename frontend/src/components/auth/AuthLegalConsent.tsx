import type { MouseEvent } from "react";

interface AuthLegalConsentProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
  termsUrl?: string;
  privacyUrl?: string;
  id?: string;
  className?: string;
}

export function AuthLegalConsent({
  checked,
  onChange,
  error,
  termsUrl,
  privacyUrl,
  id,
  className = "",
}: AuthLegalConsentProps) {
  const controlId = id ?? "auth-legal-consent";

  const stopLink = (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation();
  };

  return (
    <div className={`auth-consent ${error ? "invalid" : ""} ${className}`}>
      <button
        type="button"
        id={controlId}
        role="checkbox"
        aria-checked={checked}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${controlId}-error` : undefined}
        className="auth-consent-row"
        onClick={() => onChange(!checked)}
      >
        <span className="auth-consent-box">
          {checked && (
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m5 12.5 4.5 4.5L19 7.5" />
            </svg>
          )}
        </span>

        <span className="auth-consent-text">
          I agree to the ContextOS{" "}
          {termsUrl ? (
            <a
              href={termsUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="auth-consent-link"
              onClick={stopLink}
            >
              Terms
            </a>
          ) : (
            <span className="auth-consent-static">Terms</span>
          )}{" "}
          and{" "}
          {privacyUrl ? (
            <a
              href={privacyUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="auth-consent-link"
              onClick={stopLink}
            >
              Privacy Policy
            </a>
          ) : (
            <span className="auth-consent-static">Privacy Policy</span>
          )}
          .
        </span>
      </button>

      {error && (
        <span className="auth-consent-error" id={`${controlId}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}