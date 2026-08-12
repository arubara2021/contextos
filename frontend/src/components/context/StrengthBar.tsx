import { strengthCategory } from "../../constants";
import { clamp01 } from "../../utils/color";
import type { StrengthCategory } from "../../types";

interface StrengthBarProps {
  strength: number;
  category?: StrengthCategory;
  showValue?: boolean;
  size?: "sm" | "md";
}

export function StrengthBar({
  strength,
  category,
  showValue = true,
  size = "md",
}: StrengthBarProps) {
  const cat = category ?? strengthCategory(strength);
  const pct = Math.round(clamp01(strength) * 100);
  const valueClass =
    cat === "critical"
      ? "text-flare fx-flicker"
      : cat === "forgotten"
        ? "text-stone/50"
        : "text-ember-hi";

  return (
    <div
      className="strength-meter"
      data-cat={cat}
      style={{ alignItems: "center", marginBottom: 0 }}
    >
      <div className="strength-track flex-1">
        <div className="strength-fill" style={{ width: `${pct}%` }} />
      </div>
      {showValue && (
        <span className={`t-mono ${size === "sm" ? "text-[10px]" : "text-[12px]"} ${valueClass}`}>
          {pct}%
        </span>
      )}
    </div>
  );
}