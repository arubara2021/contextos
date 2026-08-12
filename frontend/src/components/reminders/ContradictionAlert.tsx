import { useState } from "react";
import { Icon } from "../shared/Icon";
import { relativeTime } from "../../utils/date";
import type { Contradiction } from "../../types";

interface ContradictionAlertProps {
  contradiction: Contradiction;
  onResolve: (contradictionId: string) => void | Promise<void>;
}

export function ContradictionAlert({ contradiction, onResolve }: ContradictionAlertProps) {
  const [busy, setBusy] = useState(false);

  return (
    <article className="relative overflow-hidden rounded-xl border border-mineral/30 bg-mineral-faint p-4">
      <span className="absolute bottom-0 left-0 top-0 w-[3px] bg-gradient-to-b from-mineral-hi to-mineral-deep" />

      <div className="flex items-center gap-2.5">
        <svg width="26" height="14" viewBox="0 0 26 14" fill="none" className="flex-none" aria-hidden="true">
          <circle cx="4" cy="7" r="3" fill="#FF8A3D" />
          <circle cx="22" cy="7" r="3" fill="#8FD8D2" />
          <path
            className="fx-flicker"
            d="M8 7l2.5-3 2 5 2.5-4 1 2h2"
            stroke="#FF5C49"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <p className="t-mono text-[9px] uppercase tracking-[0.24em] text-mineral">
          Memory conflict
        </p>
      </div>

      <p className="mt-2.5 text-[13px] font-light leading-relaxed text-bone">
        {contradiction.conflictDescription}
      </p>

      <blockquote className="mt-2.5 rounded-lg border border-line bg-coal px-3 py-2 text-[12px] font-light italic leading-relaxed text-stone">
        “{contradiction.newInformation}”
      </blockquote>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="t-mono text-[8.5px] uppercase tracking-[0.18em] text-stone/50">
          {relativeTime(contradiction.createdAt)}
        </span>
        <button
          className="btn btn-mineral btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onResolve(contradiction.contradictionId);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Icon name="check" size={12} />
          {busy ? "Resolving…" : "Resolve"}
        </button>
      </div>
    </article>
  );
}