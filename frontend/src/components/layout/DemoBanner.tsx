import { useDemo } from "../../hooks/useDemo";
import { Icon } from "../shared/Icon";

export function DemoBanner() {
  const { isDemoActive, formattedRemaining, bannerHidden, hideBanner } = useDemo();
  if (!isDemoActive || bannerHidden) return null;

  const isUrgent = formattedRemaining.startsWith("0");

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(10px_+_env(safe-area-inset-top))] z-toast flex justify-center px-4">
      <div
        className={[
          "pointer-events-auto fx-slide-up flex items-center gap-3 rounded-full border px-4 py-2 shadow-lift backdrop-blur-xl",
          isUrgent
            ? "border-flare/50 bg-flare/10 text-flare"
            : "border-mineral/35 bg-coal/85 text-mineral",
        ].join(" ")}
      >
        <span
          className={[
            "h-2 w-2 flex-none rounded-full",
            isUrgent ? "bg-flare fx-flicker" : "bg-mineral fx-breathe",
          ].join(" ")}
        />

        <span className="t-mono text-[9px] uppercase tracking-[0.22em]">Sandbox</span>

        <span
          className={[
            "t-mono text-[11px] font-semibold tabular-nums",
            isUrgent ? "text-flare" : "text-bone",
          ].join(" ")}
        >
          {formattedRemaining}
        </span>

        <span className="t-mono hidden text-[8.5px] uppercase tracking-[0.16em] text-stone/70 sm:inline">
          nothing saved
        </span>

        <button
          onClick={hideBanner}
          className="ml-1 grid h-6 w-6 place-items-center rounded-full text-stone/70 transition-colors hover:bg-soot hover:text-bone"
          aria-label="Hide sandbox banner"
        >
          <Icon name="close" size={11} />
        </button>
      </div>
    </div>
  );
}