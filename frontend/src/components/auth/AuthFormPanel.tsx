import type { ReactNode } from "react";
import { Logo } from "../shared/Logo";

interface AuthFormPanelProps {
  kicker: string;
  title: ReactNode;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function AuthFormPanel({
  kicker,
  title,
  subtitle,
  children,
  footer,
}: AuthFormPanelProps) {
  return (
    <section className="relative w-full">
      <div className="mx-auto flex w-full max-w-[520px] flex-col">
        <div className="mb-8 flex items-center gap-3 lg:hidden">
          <Logo size={38} />
          <span className="font-display text-xl font-medium text-bone">
            Context
            <span className="align-super font-mono text-[10px] tracking-[0.2em] text-ember">
              OS
            </span>
          </span>
        </div>

        <div className="relative">
          <div className="pointer-events-none absolute -left-8 top-1 hidden h-24 w-px bg-gradient-to-b from-transparent via-ember/50 to-transparent lg:block" />

          <p className="kicker">{kicker}</p>

          <h2 className="font-display text-4xl font-medium leading-[1.04] tracking-[-0.02em] text-bone sm:text-5xl">
            {title}
          </h2>

          {subtitle && (
            <p className="mt-3 text-sm font-light leading-relaxed text-stone">
              {subtitle}
            </p>
          )}
        </div>

        <div className="mt-8">{children}</div>

        {footer && <div className="mt-8">{footer}</div>}
      </div>
    </section>
  );
}