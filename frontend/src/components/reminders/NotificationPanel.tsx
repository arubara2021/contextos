import { useEffect, type CSSProperties } from "react";
import { Icon } from "../shared/Icon";
import { ReminderCard } from "./ReminderCard";
import { ContradictionAlert } from "./ContradictionAlert";
import type { Contradiction, Reminder } from "../../types";

interface NotificationPanelProps {
  open: boolean;
  onClose: () => void;
  reminders: Reminder[];
  contradictions: Contradiction[];
  onDismiss: (reminderId: string) => void | Promise<void>;
  onBoost: (reminderId: string, bucketIds: string[]) => void | Promise<void>;
  onResolve: (contradictionId: string) => void | Promise<void>;
}

function stagger(index: number): CSSProperties {
  return { "--rise-delay": `${index * 0.055}s` } as CSSProperties;
}

export function NotificationPanel({
  open,
  onClose,
  reminders,
  contradictions,
  onDismiss,
  onBoost,
  onResolve,
}: NotificationPanelProps) {
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const activeReminders = reminders.filter((reminder) => !reminder.dismissed && !reminder.actionTaken);
  const total = activeReminders.length + contradictions.length;

  return (
    <div
      role="dialog"
      aria-label="Signals"
      className="fx-scale-in absolute right-0 top-full z-drawer mt-3 w-[min(400px,calc(100vw_-_24px))] overflow-hidden rounded-[26px] border border-line-strong bg-panel shadow-lift backdrop-blur-xl"
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ember/55 to-transparent" />

      <div className="relative border-b border-line px-5 py-4">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(280px 120px at 88% -35%, rgb(255 138 61 / 0.16), transparent 68%), radial-gradient(220px 100px at 4% 135%, rgb(143 216 210 / 0.1), transparent 64%)",
          }}
        />

        <div className="relative flex items-center justify-between gap-3">
          <div>
            <p className="t-mono text-[10px] uppercase tracking-[0.26em] text-stone">Signals</p>
            <p className="font-display text-lg font-medium text-bone">
              {total === 0 ? "Archive quiet" : `${total} active`}
            </p>
          </div>

          <button className="btn btn-icon" onClick={onClose} aria-label="Close signals">
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      <div className="scroll-area flex max-h-[440px] flex-col gap-3 overscroll-contain px-4 py-4">
        {total === 0 && (
          <div className="fx-rise flex flex-col items-center gap-4 rounded-[22px] border border-dashed border-line-strong bg-coal/40 px-6 py-12 text-center">
            <span className="empty-glyph !h-14 !w-14">
              <Icon name="bell" size={20} />
            </span>

            <div>
              <p className="font-display text-lg font-medium text-bone">The archive is quiet.</p>
              <p className="mt-2 text-[13px] font-light leading-relaxed text-stone">
                Nothing is fading, and no memories are in conflict.
              </p>
            </div>
          </div>
        )}

        {contradictions.length > 0 && (
          <div className="fx-rise mt-1 flex items-center gap-3 px-1" style={stagger(0)}>
            <span className="t-mono text-[9px] uppercase tracking-[0.24em] text-flare">
              Contradictions · {contradictions.length}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-flare/35 to-transparent" />
          </div>
        )}

        {contradictions.map((contradiction, index) => (
          <div key={contradiction.contradictionId} className="fx-rise" style={stagger(index + 1)}>
            <ContradictionAlert
              contradiction={contradiction}
              onResolve={(contradictionId) => void onResolve(contradictionId)}
            />
          </div>
        ))}

        {activeReminders.length > 0 && (
          <div className="fx-rise mt-2 flex items-center gap-3 px-1" style={stagger(contradictions.length + 2)}>
            <span className="t-mono text-[9px] uppercase tracking-[0.24em] text-ember">
              Fading memories · {activeReminders.length}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-ember/35 to-transparent" />
          </div>
        )}

        {activeReminders.map((reminder, index) => (
          <div key={reminder.reminderId} className="fx-rise" style={stagger(contradictions.length + index + 3)}>
            <ReminderCard
              reminder={reminder}
              onReignite={async (value) => {
                await onBoost(
                  value.reminderId,
                  value.memories.map((memory) => memory.bucketId)
                );
              }}
              onDismiss={(value) => void onDismiss(value.reminderId)}
            />
          </div>
        ))}
      </div>

      <div className="border-t border-line px-5 py-3">
        <p className="t-mono text-[8.5px] uppercase tracking-[0.2em] text-stone/50">
          Reigniting strengthens the memory · decay pauses for nothing
        </p>
      </div>
    </div>
  );
}