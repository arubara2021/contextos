import { useState, type InputHTMLAttributes } from "react";

interface AuthPasswordFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
  hint?: string;
}

export function AuthPasswordField({
  label,
  error,
  hint,
  id,
  className,
  ...rest
}: AuthPasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  const inputId =
    id ?? `auth-password-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

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
          type={visible ? "text" : "password"}
          className={`w-full bg-transparent px-4 py-3.5 pr-[76px] text-[16px] font-light text-bone outline-none placeholder:text-stone/40 sm:text-[15px] ${
            className ?? ""
          }`}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          {...rest}
        />

        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg border border-line bg-coal/80 px-2.5 py-1.5 font-mono text-[8.5px] uppercase tracking-[0.18em] text-stone transition-colors hover:text-bone"
          onClick={() => setVisible((value) => !value)}
          aria-pressed={visible}
        >
          {visible ? "Hide" : "Show"}
        </button>
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