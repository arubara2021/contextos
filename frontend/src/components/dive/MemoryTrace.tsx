import type { InjectedMemory } from "../../types";
import { typeColor } from "../../utils/color";

interface MemoryTraceProps {
  memories: InjectedMemory[];
  onInspect: (bucketId: string) => void;
}

export function MemoryTrace({ memories, onInspect }: MemoryTraceProps) {
  if (memories.length === 0) return null;

  return (
    <div className="memory-trace">
      <span className="trace-label">memory trace</span>
      {memories.map((memory, index) => {
        const color = typeColor(memory.conceptType);
        return (
          <button
            key={memory.bucketId}
            className="trace-chip group relative fx-ignite"
            style={{ animationDelay: `${index * 90}ms` }}
            onClick={() => onInspect(memory.bucketId)}
            aria-label={`${memory.label}, strength ${Math.round(memory.strength * 100)} percent. Focus in the cortex`}
          >
            <span className="trace-node">{memory.rank}</span>
            <span
              className="h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: color, boxShadow: `0 0 5px ${color}` }}
            />
            <span className="max-w-44 truncate">{memory.label}</span>
            <span className="trace-strength">
              {Math.round(memory.strength * 100)}%
            </span>

            <span className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 z-20 hidden w-60 -translate-x-1/2 translate-y-1 rounded-xl border border-line-strong bg-[linear-gradient(165deg,#1e1714,#120e0b)] p-3 text-left opacity-0 shadow-lift backdrop-blur-xl transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 sm:block">
              <span className="mb-1.5 flex items-center gap-2">
                <span
                  className="h-1.5 w-1.5 flex-none rounded-full"
                  style={{ background: color, boxShadow: `0 0 6px ${color}` }}
                />
                <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-stone">
                  {memory.conceptType} · {memory.source}
                </span>
              </span>
              <span className="block overflow-hidden text-[11.5px] font-light leading-[1.55] text-bone/90 [-webkit-box-orient:vertical] [-webkit-line-clamp:3] [display:-webkit-box]">
                {memory.definition}
              </span>
              <span className="mt-2 block font-mono text-[8px] uppercase tracking-[0.18em] text-stone/70">
                relevance {memory.relevanceScore.toFixed(2)} · click to focus
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}