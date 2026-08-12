import { useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface DropdownItem {
  key: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  danger?: boolean;
  active?: boolean;
}

interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  onSelect: (key: string) => void;
  align?: "left" | "right";
}

export function Dropdown({ trigger, items, onSelect, align = "right" }: DropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-flex">
      <button type="button" className="inline-flex items-center" onClick={() => setOpen((v) => !v)}>
        {trigger}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-hud" onClick={() => setOpen(false)} />
          <div
            className={`fx-rise absolute top-full z-drawer mt-2 w-60 overflow-hidden rounded-xl border border-line-strong bg-panel shadow-lift ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {items.map((item) => (
              <button
                key={item.key}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-soot ${
                  item.danger ? "text-flare" : item.active ? "text-ember-hi" : "text-bone"
                }`}
                onClick={() => {
                  onSelect(item.key);
                  setOpen(false);
                }}
              >
                {item.icon && (
                  <span className={item.danger ? "text-flare" : "text-stone"}>{item.icon}</span>
                )}
                <span className="flex-1">
                  <span className="block text-[13px]">{item.label}</span>
                  {item.hint && (
                    <span className="t-mono block text-[8.5px] uppercase tracking-[0.16em] text-stone/60">
                      {item.hint}
                    </span>
                  )}
                </span>
                {item.active && <Icon name="check" size={13} className="text-ember" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}