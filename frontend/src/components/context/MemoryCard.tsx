import { TypeBadge } from "./TypeBadge";
import { StrengthBar } from "./StrengthBar";
import { relativeTime } from "../../utils/date";
import type { MemorySummary } from "../../types";

interface MemoryCardProps {
  memory: MemorySummary;
  onClick?: (bucketId: string) => void;
  active?: boolean;
}

export function MemoryCard({ memory, onClick, active = false }: MemoryCardProps) {
  const critical = memory.category === "critical";

  return (
    <button
      className={`group block w-full rounded-2xl border p-4 text-left transition-all duration-300 ${
        active
          ? "border-ember/50 bg-ember-faint shadow-ember"
          : "border-line bg-panel hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
      }`}
      onClick={() => onClick?.(memory.bucketId)}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-[17px] font-medium leading-snug text-bone">
          {memory.canonical}
        </p>
        {critical && (
          <span className="fx-flicker mt-1.5 h-2 w-2 flex-none rounded-full bg-flare shadow-[0_0_8px_rgba(255,92,73,0.6)]" />
        )}
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <TypeBadge type={memory.conceptType} size="sm" />
        <span className="t-mono text-[9px] uppercase tracking-[0.14em] text-stone/60">
          imp {memory.importance}/10
        </span>
      </div>

      <div className="mt-3.5">
        <StrengthBar strength={memory.strength} category={memory.category} size="sm" />
      </div>

      <div className="t-mono mt-3 flex items-center justify-between text-[9px] uppercase tracking-[0.14em] text-stone/60">
        <span>{memory.accessCount} accesses</span>
        <span>{relativeTime(memory.lastAccessed)}</span>
      </div>
    </button>
  );
}