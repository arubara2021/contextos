import type { InputHTMLAttributes } from "react";

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
}

export function AuthField({
  label,
  error,
  hint,
  id,
  className,
  ...rest
}: AuthFieldProps) {
  const inputId =
    id ?? `auth-field-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  const describedBy = error
    ? `${inputId}-error`
    : hint
      ? `${inputId}-hint`
      : undefined;

  return (
    <div className="field mb-0">
      <label className="label" htmlFor={inputId}>
        {label}
      </label>

      <div
        className={`relative overflow-hidden rounded-2xl border bg-[linear-gradient(160deg,#1a1411,#100d0b)] transition-all duration-200 ${
          error
            ? "border-flare/50 shadow-[0_0_0_4px_rgb(255_92_73/0.08)]"
            : "border-line-strong/70 focus-within:border-ember/55 focus-within:shadow-[0_0_0_4px_rgb(255_138_61/0.12),0_0_34px_-12px_rgb(255_138_61/0.45)]"
        }`}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <input
          id={inputId}
          className={`w-full bg-transparent px-4 py-3.5 text-[16px] font-light text-bone outline-none placeholder:text-stone/40 sm:text-[15px] ${
            className ?? ""
          }`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...rest}
        />
      </div>

      {error ? (
        <span className="field-error fx-rise mt-2" id={`${inputId}-error`}>
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint mt-2" id={`${inputId}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}