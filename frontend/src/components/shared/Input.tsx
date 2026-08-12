import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string | null;
}

export function Input({ label, hint, error, id, className = "", ...rest }: InputProps) {
  const inputId =
    id ?? (label ? `input-${label.toLowerCase().replace(/\s+/g, "-")}` : undefined);

  return (
    <div className="field">
      {label && (
        <label className="label" htmlFor={inputId}>
          {label}
        </label>
      )}
      <input id={inputId} className={`input ${error ? "invalid" : ""} ${className}`} {...rest} />
      {error ? (
        <span className="field-error fx-rise">{error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </div>
  );
}