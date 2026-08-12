import type { ReactNode } from "react";
import { Icon } from "../shared/Icon";

interface CortexToolbarProps {
  canGoBack?: boolean;
  onBack?: () => void;
  onSearch?: () => void;
  onFilters?: () => void;
  onLegend?: () => void;
  onFit?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  searchActive?: boolean;
  filtersActive?: boolean;
  legendActive?: boolean;
  isInsideDocument?: boolean;
}

function ToolButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={[
        "grid h-10 min-w-10 place-items-center rounded-xl border px-2.5 transition-all duration-200",
        active
          ? "border-ember/45 bg-ember-faint text-ember-hi"
          : "border-transparent text-stone hover:bg-soot hover:text-bone",
        disabled ? "pointer-events-none opacity-35" : "",
      ].join(" ")}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}

export function CortexToolbar({
  canGoBack = false,
  onBack,
  onSearch,
  onFilters,
  onLegend,
  onFit,
  onZoomIn,
  onZoomOut,
  searchActive = false,
  filtersActive = false,
  legendActive = false,
  isInsideDocument = false,
}: CortexToolbarProps) {
  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-[calc(84px_+_env(safe-area-inset-top))] z-hud hidden justify-center md:flex">
        <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-line-strong bg-coal/80 p-1.5 shadow-lift backdrop-blur-xl">
          {canGoBack && (
            <ToolButton label="Back to core" onClick={onBack}>
              <span className="px-1 text-[15px]">←</span>
            </ToolButton>
          )}

          <ToolButton label="Search memories" active={searchActive} onClick={onSearch}>
            <Icon name="search" size={17} />
          </ToolButton>

          <ToolButton label="Filters" active={filtersActive} onClick={onFilters}>
            <Icon name="settings" size={17} />
          </ToolButton>

          <ToolButton label="Legend" active={legendActive} onClick={onLegend}>
            <Icon name="panel" size={17} />
          </ToolButton>

          <span className="mx-1 h-5 w-px bg-line-strong" />

          <ToolButton label="Fit view" onClick={onFit}>
            <span className="px-1 font-mono text-[11px] uppercase tracking-[0.14em]">
              Fit
            </span>
          </ToolButton>

          {onZoomOut && (
            <ToolButton label="Zoom out" onClick={onZoomOut}>
              <span className="px-1 text-[15px]">−</span>
            </ToolButton>
          )}

          {onZoomIn && (
            <ToolButton label="Zoom in" onClick={onZoomIn}>
              <span className="px-1 text-[15px]">+</span>
            </ToolButton>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-[calc(84px_+_env(safe-area-inset-bottom))] z-hud flex justify-center md:hidden">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-line-strong bg-coal/90 px-2 py-1.5 shadow-lift backdrop-blur-xl">
          {canGoBack && (
            <ToolButton label="Back to core" onClick={onBack}>
              <span className="px-1 text-[15px]">←</span>
            </ToolButton>
          )}

          <ToolButton label="Search memories" active={searchActive} onClick={onSearch}>
            <Icon name="search" size={18} />
          </ToolButton>

          {isInsideDocument && (
            <ToolButton label="Filters" active={filtersActive} onClick={onFilters}>
              <Icon name="settings" size={18} />
            </ToolButton>
          )}

          <ToolButton label="Fit view" onClick={onFit}>
            <span className="px-1 font-mono text-[10px] uppercase tracking-[0.14em]">
              Fit
            </span>
          </ToolButton>
        </div>
      </div>
    </>
  );
}