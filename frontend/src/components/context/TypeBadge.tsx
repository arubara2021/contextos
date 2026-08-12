import { CONCEPT_TYPES } from "../../constants";
import type { ConceptType } from "../../types";

interface TypeBadgeProps {
  type: ConceptType;
  size?: "sm" | "md";
  showLabel?: boolean;
}

export function TypeBadge({ type, size = "md", showLabel = true }: TypeBadgeProps) {
  return (
    <span
      className={`type-badge ${size === "sm" ? "!gap-1.5 !px-2 !py-[3px] !text-[8px]" : ""}`}
      data-type={type}
    >
      {showLabel ? (CONCEPT_TYPES[type]?.label ?? type) : null}
    </span>
  );
}