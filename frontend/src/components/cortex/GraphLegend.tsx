import { Icon } from "../shared/Icon";

interface GraphLegendProps {
  variant?: "inline" | "overlay";
  open?: boolean;
  onClose?: () => void;
}

function LegendRow({ visual, label }: { visual: JSX.Element; label: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-6 w-9 flex-none place-items-center">{visual}</span>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-stone">
        {label}
      </span>
    </div>
  );
}

function GraphLegendContent() {
  return (
    <div className="flex flex-col gap-2.5">
      <p className="t-mono text-[9px] uppercase tracking-[0.26em] text-stone">Reading the field</p>

      <div className="grid grid-cols-1 gap-2">
        <LegendRow
          visual={<span className="h-2.5 w-2.5 rounded-full bg-ember shadow-ember" />}
          label="Strong · 70%+"
        />

        <LegendRow
          visual={<span className="h-2.5 w-2.5 rounded-full bg-[#B06F3A]" />}
          label="Fading · 40–70%"
        />

        <LegendRow
          visual={<span className="h-2.5 w-2.5 rounded-full bg-flare shadow-[0_0_10px_var(--flare-glow)]" />}
          label="Critical · <40%"
        />

        <LegendRow
          visual={<span className="h-2.5 w-2.5 rounded-full bg-[#57504A]" />}
          label="Forgotten · <10%"
        />
      </div>

      <div className="my-1 h-px bg-line" />

      <div className="grid grid-cols-1 gap-2">
        <LegendRow
          visual={<span className="h-0 w-7 border-t-[1.5px] border-stone" />}
          label="Causes"
        />

        <LegendRow
          visual={<span className="h-0 w-7 border-t-[1.5px] border-dashed border-stone" />}
          label="Evolves into"
        />

        <LegendRow
          visual={<span className="h-0 w-7 border-t-[1.5px] border-dotted border-stone" />}
          label="Related to"
        />

        <LegendRow
          visual={<span className="h-0 w-7 border-t-[1.5px] border-dashed border-mineral/70" />}
          label="Cross-document bridge"
        />
      </div>

      <div className="my-1 h-px bg-line" />

      <div className="grid grid-cols-1 gap-2">
        <LegendRow
          visual={
            <span className="h-4 w-7 rounded-[8px] border border-ember/55 bg-coal/90 shadow-[0_0_14px_rgba(255,138,61,0.16)]" />
          }
          label="Document node"
        />

        <LegendRow
          visual={
            <span className="h-4 w-7 rounded-[8px] border border-dashed border-stone/70 bg-coal/70" />
          }
          label="Solo document"
        />

        <LegendRow
          visual={
            <span className="h-3 w-3 rounded-full border border-dashed border-stone/80 bg-transparent" />
          }
          label="Island memory"
        />
      </div>
    </div>
  );
}

export function GraphLegend({ variant = "inline", open = false, onClose }: GraphLegendProps) {
  if (variant === "inline") {
    return <GraphLegendContent />;
  }

  return (
    <>
      <div
        className={[
          "fixed inset-0 z-veil transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        ].join(" ")}
        style={{
          background: "rgba(8, 6, 5, 0.45)",
          backdropFilter: "blur(2px)",
        }}
        onClick={onClose}
      />

      <div
        className={[
          "fixed left-1/2 top-[calc(122px_+_env(safe-area-inset-top))] z-drawer hidden w-[min(360px,calc(100vw-48px))] -translate-x-1/2 transition-all duration-300 md:block",
          open ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-2 opacity-0",
        ].join(" ")}
      >
        <div className="rounded-3xl border border-line-strong bg-coal/90 p-4 shadow-lift backdrop-blur-xl">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="t-mono text-[9px] uppercase tracking-[0.24em] text-stone">
              Legend
            </span>

            <button
              className="grid h-8 w-8 place-items-center rounded-xl text-stone transition-all hover:bg-soot hover:text-bone"
              onClick={onClose}
              aria-label="Close legend"
            >
              <Icon name="close" size={14} />
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <GraphLegendContent />
          </div>
        </div>
      </div>

      <aside className={`cortex-sheet md:hidden ${open ? "open" : ""}`} aria-hidden={!open}>
        <span className="cortex-sheet-grabber shrink-0" />

        <div className="cortex-sheet-head shrink-0">
          <span className="cortex-sheet-title">Legend</span>

          <button className="cortex-sheet-close" onClick={onClose} aria-label="Close legend">
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="cortex-list flex min-h-0 flex-1 flex-col overflow-y-auto">
          <GraphLegendContent />
        </div>
      </aside>
    </>
  );
}


