import { useState } from "react";
import { Icon } from "../shared/Icon";

interface ReigniteButtonProps {
  onReignite: () => void | Promise<void>;
  disabled?: boolean;
  size?: "sm" | "md";
  full?: boolean;
}

export function ReigniteButton({
  onReignite,
  disabled = false,
  size = "md",
  full = false,
}: ReigniteButtonProps) {
  const [firing, setFiring] = useState(false);

  const handleClick = async () => {
    if (disabled || firing) return;
    setFiring(true);
    try {
      await onReignite();
    } finally {
      window.setTimeout(() => setFiring(false), 900);
    }
  };

  return (
    <button
      className={`reignite-btn ${firing ? "firing" : ""} ${
        size === "sm" ? "!rounded-[10px] !px-3.5 !py-2 !text-[12px]" : ""
      }`}
      style={{ flex: full ? 1 : "0 0 auto" }}
      onClick={() => void handleClick()}
      disabled={disabled || firing}
      title="Boost this memory back to full strength"
    >
      <Icon name="refresh" size={size === "sm" ? 13 : 16} className={firing ? "fx-spin-slow" : ""} />
      {firing ? "Reigniting…" : "Reignite"}
    </button>
  );
}