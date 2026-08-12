import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "../shared/Icon";
import { NotificationPanel } from "../reminders/NotificationPanel";
import { useReminders } from "../../hooks/useReminders";
import { ROUTES } from "../../constants";
import { formatFull } from "../../utils/date";

const SECTIONS = [
  { match: ROUTES.archive, label: "The Archive" },
  { match: ROUTES.settings, label: "Settings" },
  { match: ROUTES.onboarding, label: "Ignition" },
];

export function TopHud() {
  const location = useLocation();

  const {
    reminders,
    contradictions,
    criticalCount,
    dismiss,
    boost,
    resolveContradiction,
  } = useReminders();

  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    setPanelOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!panelOpen) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPanelOpen(false);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelOpen]);

  const section =
    SECTIONS.find((entry) => location.pathname.startsWith(entry.match))?.label ??
    "Memory Cortex";

  const compact = location.pathname.startsWith(ROUTES.cortex);

  const bellBtn = (
    <button
      className={[
        "relative grid place-items-center rounded-2xl border transition-all duration-250",
        "h-10 w-10",
        criticalCount > 0
          ? "border-flare/50 bg-flare/10 text-flare"
          : "border-line-strong bg-coal/60 text-stone hover:-translate-y-0.5 hover:text-bone",
      ].join(" ")}
      onClick={() => setPanelOpen((value) => !value)}
      aria-label="Signals"
      aria-expanded={panelOpen}
    >
      {criticalCount > 0 && (
        <span className="absolute inset-1 rounded-full border border-flare/50 animate-ping" />
      )}

      <Icon name="bell" size={18} />

      {criticalCount > 0 && (
        <span className="absolute -right-1.5 -top-1.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-flare px-1 font-mono text-[9px] font-semibold text-[#1b0f0c] shadow-[0_0_12px_var(--flare-glow)]">
          {criticalCount}
        </span>
      )}
    </button>
  );

  return (
    <>
      <div className="fixed right-3 top-[calc(10px_+_env(safe-area-inset-top))] z-[65] lg:hidden">
        <div className="pointer-events-auto relative">
          {bellBtn}
          {panelOpen && (
            <div
              className="fixed inset-0 z-[59]"
              onClick={() => setPanelOpen(false)}
              aria-hidden="true"
            />
          )}
          <NotificationPanel
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
            reminders={reminders}
            contradictions={contradictions}
            onDismiss={dismiss}
            onBoost={boost}
            onResolve={resolveContradiction}
          />
        </div>
      </div>

      <header className="pointer-events-none fixed top-0 z-[65] hidden lg:left-[72px] lg:right-0 lg:block">
        <div className="pointer-events-auto flex items-center justify-between gap-3 border-b border-line bg-[#0e0b09]/95 px-5 py-3 backdrop-blur-xl">
          <div className="min-w-0">
            <p
              className={[
                "font-mono text-[8.5px] uppercase tracking-[0.28em] text-ember",
                compact ? "hidden xl:block" : "",
              ].join(" ")}
            >
              {formatFull(new Date())}
            </p>
            <h1
              className={[
                "truncate font-display font-medium tracking-[0.01em] text-bone",
                compact ? "text-[14px] lg:text-[18px]" : "text-[16px] lg:text-[18px]",
              ].join(" ")}
            >
              {section}
            </h1>
          </div>

          <div className="relative">
            {bellBtn}

            {panelOpen && (
              <div
                className="fixed inset-0 z-[59]"
                onClick={() => setPanelOpen(false)}
                aria-hidden="true"
              />
            )}

            <NotificationPanel
              open={panelOpen}
              onClose={() => setPanelOpen(false)}
              reminders={reminders}
              contradictions={contradictions}
              onDismiss={dismiss}
              onBoost={boost}
              onResolve={resolveContradiction}
            />
          </div>
        </div>
      </header>
    </>
  );
}