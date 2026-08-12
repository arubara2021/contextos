import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "mineral" | "danger";
  size?: "sm" | "md";
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  block = false,
  loading = false,
  icon,
  children,
  className = "",
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${size === "sm" ? "btn-sm" : ""} ${block ? "btn-block" : ""} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? (
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 animate-ping rounded-full bg-current" />
        </span>
      ) : (
        icon
      )}
      {children}
    </button>
  );
}