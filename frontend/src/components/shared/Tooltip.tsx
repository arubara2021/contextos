import type { ReactNode } from "react";

interface TooltipProps {
  label: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}

const SIDE_CLASSES: Record<"top" | "bottom" | "left" | "right", string> = {
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  left: "right-full top-1/2 mr-2 -translate-y-1/2",
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
};

export function Tooltip({ label, side = "top", children }: TooltipProps) {
  return (
    <span className="group/tt relative inline-flex">
      {children}
      <span
        className={`t-mono pointer-events-none absolute z-[70] whitespace-nowrap rounded-md border border-line-strong bg-bark px-2.5 py-1.5 text-[9px] uppercase tracking-[0.16em] text-bone opacity-0 shadow-lift transition-opacity duration-200 group-hover/tt:opacity-100 ${SIDE_CLASSES[side]}`}
      >
        {label}
      </span>
    </span>
  );
}