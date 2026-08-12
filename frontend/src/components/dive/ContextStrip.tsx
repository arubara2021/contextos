import type { CSSProperties } from "react";
import { Icon } from "../shared/Icon";
import type { InjectedMemory } from "../../types";
import { strengthColor, strengthGlow } from "../../utils/color";

interface ContextStripProps {
  open: boolean;
  onClose: () => void;
  injected: InjectedMemory[];
  available: InjectedMemory[];
  budgetUsed: number;
  budgetMax: number;
}

function budgetMood(percent: number): string {
  if (percent >= 90) return "near capacity";
  if (percent >= 60) return "warming up";
  if (percent >= 25) return "focused";
  return "room to think";
}

export function ContextStrip({
  open,
  onClose,
  injected,
  available,
  budgetUsed,
  budgetMax,
}: ContextStripProps) {
  const safeInjected = Array.isArray(injected)
    ? injected.filter((memory) => memory && memory.label)
    : [];
  const injectedIds = new Set(
    safeInjected
      .map((memory) => memory.bucketId)
      .filter((id): id is string => typeof id === "string" && id.length > 0)
  );
  const safeAvailable = (Array.isArray(available) ? available : []).filter(
    (memory) =>
      memory &&
      memory.label &&
      !(typeof memory.bucketId === "string" && injectedIds.has(memory.bucketId))
  );

  const budgetPercent =
    budgetMax > 0 ? Math.min(100, (budgetUsed / budgetMax) * 100) : 0;
  const candidates = safeInjected.length + safeAvailable.length;

  return (
    <aside className={`context-strip ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="strip-head">
        <span className="strip-title">Active context</span>
        <button
          className="btn btn-icon !h-8 !w-8"
          onClick={onClose}
          aria-label="Close context strip"
        >
          <Icon name="close" size={14} />
        </button>
      </div>

      <div className="mb-4 rounded-2xl border border-line bg-[rgb(22_17_16/0.5)] p-3.5">
        <div className="mb-2.5 flex items-baseline justify-between gap-2">
          <span className="t-mono text-[9px] uppercase tracking-[0.22em] text-stone">
            forgetting budget
          </span>
          <span className="t-mono text-[11px] text-ember-hi">
            {budgetUsed}/{budgetMax}
          </span>
        </div>
        <div className="relative h-[6px] overflow-hidden rounded-full bg-[rgb(236_229_218/0.07)]">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-ember-deep via-ember to-ember-hi transition-[width] duration-500 ease-out"
            style={{
              width: `${budgetPercent}%`,
              boxShadow: "0 0 12px var(--ember-glow)",
            }}
          />
          {[25, 50, 75].map((tick) => (
            <span
              key={tick}
              className="absolute top-0 h-full w-px bg-[rgb(14_11_9/0.6)]"
              style={{ left: `${tick}%` }}
            />
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="t-mono text-[8px] uppercase tracking-[0.18em] text-[color:var(--faint)]">
            {budgetMood(budgetPercent)}
          </span>
          <span className="t-mono text-[8px] uppercase tracking-[0.18em] text-[color:var(--faint)]">
            {candidates} candidates
          </span>
        </div>
      </div>

      <div className="strip-list">
        {safeInjected.length === 0 && safeAvailable.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-3 pt-10 text-center">
            <span className="empty-glyph">
              <Icon name="graph" size={22} />
            </span>
            <p className="text-[12.5px] font-light leading-[1.65] text-stone">
              No memories injected yet. Ask something that touches your past
              and watch the trace ignite.
            </p>
          </div>
        )}

        {safeInjected.length > 0 && (
          <p className="t-mono px-1 text-[9px] uppercase tracking-[0.24em] text-ember">
            injected · {safeInjected.length}
          </p>
        )}
        {safeInjected.map((memory, index) => (
          <div
            key={`inj-${memory.bucketId}`}
            className="strip-item fx-rise"
            style={{ "--rise-delay": `${index * 0.04}s` } as CSSProperties}
          >
            <span className="trace-node">{memory.rank}</span>
            <span
              className="strip-dot"
              style={{
                background: strengthColor(memory.strength),
                boxShadow: `0 0 10px ${strengthGlow(memory.strength)}`,
              }}
            />
            <span className="strip-item-name">{memory.label}</span>
            <span className="strip-item-strength">
              {Math.round(memory.strength * 100)}%
            </span>
          </div>
        ))}

        {safeAvailable.length > 0 && (
          <p className="t-mono mt-3 px-1 text-[9px] uppercase tracking-[0.24em] text-stone">
            next in line · {safeAvailable.length}
          </p>
        )}
        {safeAvailable.map((memory, index) => (
          <div
            key={`avl-${memory.bucketId}`}
            className="strip-item opacity-55 fx-rise"
            style={
              {
                "--rise-delay": `${(safeInjected.length + index) * 0.04}s`,
              } as CSSProperties
            }
          >
            <span
              className="strip-dot"
              style={{
                background: strengthColor(memory.strength),
                opacity: 0.55,
              }}
            />
            <span className="strip-item-name">{memory.label}</span>
            <span className="strip-item-strength">
              {Math.round(memory.strength * 100)}%
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}