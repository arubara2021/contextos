import type { ReactNode } from "react";

interface GradientTextProps {
  children: ReactNode;
  variant?: "ember" | "mineral" | "bone";
  className?: string;
}

const GRADIENTS: Record<"ember" | "mineral" | "bone", string> = {
  ember: "linear-gradient(120deg, #FFB15C 0%, #FF8A3D 45%, #C8551F 100%)",
  mineral: "linear-gradient(120deg, #C4EFEB 0%, #8FD8D2 50%, #4E9B95 100%)",
  bone: "linear-gradient(120deg, #ECE5DA 0%, #A29384 100%)",
};

export function GradientText({ children, variant = "ember", className = "" }: GradientTextProps) {
  return (
    <span
      className={`bg-clip-text text-transparent ${className}`}
      style={{ backgroundImage: GRADIENTS[variant] }}
    >
      {children}
    </span>
  );
}