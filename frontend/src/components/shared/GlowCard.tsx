import { useRef, type MouseEvent, type ReactNode } from "react";

interface GlowCardProps {
  children: ReactNode;
  className?: string;
  glow?: "ember" | "mineral" | "none";
  interactive?: boolean;
  onClick?: () => void;
}

const GLOW_COLORS: Record<"ember" | "mineral" | "none", string> = {
  ember: "rgba(255, 138, 61, 0.10)",
  mineral: "rgba(143, 216, 210, 0.09)",
  none: "transparent",
};

export function GlowCard({
  children,
  className = "",
  glow = "ember",
  interactive = false,
  onClick,
}: GlowCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (event: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--gx", `${event.clientX - rect.left}px`);
    el.style.setProperty("--gy", `${event.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      onClick={onClick}
      className={`group relative overflow-hidden rounded-xl border border-line bg-panel transition-all duration-300 ${
        interactive || onClick
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
          : ""
      } ${className}`}
    >
      <span
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(260px circle at var(--gx, 50%) var(--gy, 50%), ${GLOW_COLORS[glow]}, transparent 65%)`,
        }}
      />
      <span className="relative block">{children}</span>
    </div>
  );
}