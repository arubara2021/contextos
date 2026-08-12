import { useState } from "react";
import { ReigniteButton } from "./ReigniteButton";
import { StrengthBar } from "../context/StrengthBar";
import { relativeTime } from "../../utils/date";
import type { Reminder } from "../../types";

interface ReminderCardProps {
  reminder: Reminder;
  onReignite: (reminder: Reminder) => void | Promise<void>;
  onDismiss: (reminder: Reminder) => void | Promise<void>;
}

export function ReminderCard({ reminder, onReignite, onDismiss }: ReminderCardProps) {
  const [busy, setBusy] = useState(false);
  const critical = reminder.memories.some((memory) => memory.strength < 0.4);

  return (
    <article
      className={`relative overflow-hidden rounded-xl border p-4 ${
        critical ? "border-flare/35 bg-flare/5" : "border-line bg-coal"
      }`}
    >
      {critical && (
        <span className="fx-flicker absolute bottom-0 left-0 top-0 w-[3px] bg-gradient-to-b from-flare to-ember-deep" />
      )}

      <p className="text-[13.5px] font-light leading-relaxed text-bone">{reminder.message}</p>

      <div className="mt-3 flex flex-col gap-1.5">
        {reminder.memories.map((memory) => (
          <div key={memory.bucketId} className="rounded-lg border border-line bg-panel px-3 py-2">
            <div className="flex items-center justify-between gap-3">
              <span className="truncate text-[12.5px] text-bone/90">{memory.canonical}</span>
              <span className="t-mono flex-none text-[10px] text-ember-hi">
                {Math.round(memory.strength * 100)}%
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2.5">
              <div className="flex-1">
                <StrengthBar strength={memory.strength} showValue={false} size="sm" />
              </div>
              <span className="t-mono flex-none text-[8.5px] uppercase tracking-[0.12em] text-stone/60">
                {Math.round(memory.daysSinceAccess)}d idle
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3.5 flex items-center gap-2">
        <ReigniteButton
          size="sm"
          disabled={busy}
          onReignite={async () => {
            setBusy(true);
            try {
              await onReignite(reminder);
            } finally {
              setBusy(false);
            }
          }}
        />
        <button
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={() => void onDismiss(reminder)}
        >
          Keep active
        </button>
      </div>

      <p className="t-mono mt-2.5 text-[8.5px] uppercase tracking-[0.18em] text-stone/50">
        signaled {relativeTime(reminder.createdAt)}
      </p>
    </article>
  );
}