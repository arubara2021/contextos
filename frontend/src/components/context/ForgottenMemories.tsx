import type { MemorySummary } from "../../types";

interface ForgottenMemoriesProps {
  memories: MemorySummary[];
  onInspect?: (bucketId: string) => void;
}

export function ForgottenMemories({ memories, onInspect }: ForgottenMemoriesProps) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <span className="panel-title flex items-center gap-2.5">
          <span className="h-2 w-2 rounded-full bg-stone/40" />
          Cold storage · {memories.length}
        </span>
        <span className="t-mono text-[9px] uppercase tracking-[0.18em] text-stone/50">
          below 10% strength
        </span>
      </div>

      {memories.length === 0 ? (
        <p className="px-5 py-6 text-[13px] font-light text-stone">
          Nothing forgotten. Your archive holds everything.
        </p>
      ) : (
        <div className="flex flex-col">
          {memories.map((memory) => (
            <button
              key={memory.bucketId}
              className="group flex items-center gap-3 border-b border-line px-5 py-3 text-left transition-colors last:border-b-0 hover:bg-soot"
              onClick={() => onInspect?.(memory.bucketId)}
            >
              <span className="h-2 w-2 flex-none rounded-full bg-stone/30 transition-colors group-hover:bg-stone/60" />
              <span className="flex-1 truncate text-[13px] font-light text-stone transition-colors group-hover:text-bone">
                {memory.canonical}
              </span>
              <span className="t-mono text-[9px] uppercase tracking-[0.14em] text-stone/50">
                {Math.round(memory.strength * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}

      <p className="t-mono border-t border-line px-5 py-3 text-[9px] uppercase tracking-[0.18em] text-stone/50">
        Mention one in a dive to pull it back into the light
      </p>
    </section>
  );
}