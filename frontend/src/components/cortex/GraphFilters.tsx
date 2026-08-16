import { createPortal } from "react-dom";
import { useEffect, useState, type CSSProperties } from "react";
import { CONCEPT_TYPES, CONCEPT_TYPE_ORDER, CORTEX_LAYOUTS } from "../../constants";
import type { LayoutMode } from "../../cortex/types";
import type { ConceptType, CortexFilterMode } from "../../types";
import { Icon } from "../shared/Icon";

interface GraphFiltersBaseProps {
  layout?: LayoutMode;
  onLayoutChange?: (layout: LayoutMode) => void;
  activeTypes: ConceptType[];
  onToggleType: (type: ConceptType) => void;
  onShowAll: () => void;
  counts?: Record<string, number>;
  linkFilter?: CortexFilterMode;
  onLinkFilterChange?: (value: CortexFilterMode) => void;
  soloDocumentsOnly?: boolean;
  onToggleSoloDocuments?: () => void;
  showBridges?: boolean;
  onToggleBridges?: () => void;
  showLayoutSwitcher?: boolean;
  visibleCount?: number;
  totalCount?: number;
}

interface GraphFiltersProps extends GraphFiltersBaseProps {
  variant?: "inline" | "overlay";
  open?: boolean;
  onClose?: () => void;
}

const LINK_FILTERS: Array<{ value: CortexFilterMode; label: string; hint: string }> = [
  { value: "all", label: "All", hint: "Every memory in view" },
  { value: "linked", label: "Linked", hint: "Memories with connections" },
  { value: "islands", label: "Islands", hint: "Memories with no connections yet" },
];

function riseDelay(seconds: number): CSSProperties {
  return { "--rise-delay": `${seconds}s` } as CSSProperties;
}

function GraphFiltersContent(props: GraphFiltersBaseProps) {
  const {
    layout,
    onLayoutChange,
    activeTypes,
    onToggleType,
    onShowAll,
    counts,
    linkFilter,
    onLinkFilterChange,
    soloDocumentsOnly,
    onToggleSoloDocuments,
    showBridges,
    onToggleBridges,
    showLayoutSwitcher = true,
    visibleCount,
    totalCount,
  } = props;
  const computedTotal = Object.values(counts ?? {}).reduce((sum, count) => sum + count, 0);
  const total = totalCount ?? computedTotal;
  const shown = visibleCount ?? total;
  const allTypesActive = activeTypes.length === 0;
  const linkIndex = Math.max(0, LINK_FILTERS.findIndex((filter) => filter.value === linkFilter));
  const linkHint = LINK_FILTERS.find((filter) => filter.value === linkFilter)?.hint ?? "";
  return (
    <div className="flex w-full flex-col gap-5">
      <div className="fx-rise-sm flex items-center gap-2.5" style={riseDelay(0)}>
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mineral opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-mineral" />
        </span>
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-stone">
          showing <span className="text-ember-hi">{shown}</span> of {total} memories
        </span>
      </div>
      <section className="fx-rise-sm flex flex-col gap-2.5" style={riseDelay(0.06)}>
        <p className="font-mono text-[9px] uppercase tracking-[0.26em] text-faint">Concept types</p>
        <div className="flex flex-wrap gap-2">
          <button
            className={[
              "flex items-center gap-2 rounded-full border px-3.5 py-2 font-mono text-[9px] uppercase tracking-[0.16em] transition-all duration-200",
              allTypesActive
                ? "border-bone/40 bg-soot text-bone shadow-hairline"
                : "border-line text-stone hover:border-line-strong hover:text-bone",
            ].join(" ")}
            onClick={onShowAll}
          >
            <span className="h-2 w-2 rounded-full bg-bone/80 shadow-[0_0_8px_rgba(236,229,218,0.5)]" />
            All
            <span className="text-[9px] text-faint">{total}</span>
          </button>
          {CONCEPT_TYPE_ORDER.map((type) => {
            const active = activeTypes.includes(type);
            const color = CONCEPT_TYPES[type].color;
            return (
              <button
                key={type}
                className={[
                  "flex items-center gap-2 rounded-full border px-3.5 py-2 font-mono text-[9px] uppercase tracking-[0.16em] transition-all duration-200",
                  active ? "text-bone" : "border-line text-stone hover:border-line-strong hover:text-bone",
                ].join(" ")}
                style={
                  active
                    ? { borderColor: `${color}99`, background: `${color}1f`, boxShadow: `0 0 18px -6px ${color}` }
                    : undefined
                }
                onClick={() => onToggleType(type)}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                {CONCEPT_TYPES[type].label}
                <span className={`text-[9px] ${active ? "text-bone/60" : "text-faint"}`}>{counts?.[type] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </section>
      {onLinkFilterChange && linkFilter && (
        <section className="fx-rise-sm flex flex-col gap-2.5" style={riseDelay(0.12)}>
          <p className="font-mono text-[9px] uppercase tracking-[0.26em] text-faint">Connections</p>
          <div className="relative grid grid-cols-3 rounded-2xl border border-line bg-void/60 p-1">
            <span
              className="pointer-events-none absolute bottom-1 left-1 top-1 rounded-xl border border-ember/40 bg-ember-faint shadow-hairline transition-transform duration-300"
              style={{ width: "calc((100% - 8px) / 3)", transform: `translateX(${linkIndex * 100}%)` }}
            />
            {LINK_FILTERS.map((filter) => (
              <button
                key={filter.value}
                className={[
                  "relative z-10 rounded-xl px-3 py-2.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-colors duration-200",
                  linkFilter === filter.value ? "text-ember-hi" : "text-stone hover:text-bone",
                ].join(" ")}
                onClick={() => onLinkFilterChange(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <p className="text-[12px] font-light leading-relaxed text-stone/80">{linkHint}</p>
        </section>
      )}
      {onToggleBridges && (
        <section className="fx-rise-sm flex flex-col gap-2.5" style={riseDelay(0.15)}>
          <p className="font-mono text-[9px] uppercase tracking-[0.26em] text-faint">Bridges</p>
          <button
            className={[
              "flex items-center justify-between rounded-2xl border px-3.5 py-3 text-left transition-all duration-200",
              showBridges ? "border-ember/45 bg-ember-faint" : "border-line hover:border-line-strong",
            ].join(" ")}
            onClick={onToggleBridges}
          >
            <span className="text-[13px] text-bone">Show cross-domain bridges</span>
            <span
              className={[
                "grid h-5 w-5 place-items-center rounded-full border transition-all duration-200",
                showBridges ? "border-ember bg-ember text-[#2A1708]" : "border-line-strong bg-transparent",
              ].join(" ")}
            >
              {showBridges && <span className="h-1.5 w-1.5 rounded-full bg-[#2A1708]" />}
            </span>
          </button>
          <p className="text-[12px] font-light leading-relaxed text-stone/80">
            Lines between different domains. Off by default so islands stay clean.
          </p>
        </section>
      )}
      {showLayoutSwitcher && layout && onLayoutChange && (
        <section className="fx-rise-sm flex flex-col gap-2.5" style={riseDelay(0.18)}>
          <p className="font-mono text-[9px] uppercase tracking-[0.26em] text-faint">Layout</p>
          <div className="grid grid-cols-3 gap-1 rounded-2xl border border-line bg-void/40 p-1">
            {CORTEX_LAYOUTS.map((mode) => (
              <button
                key={mode}
                className={[
                  "rounded-xl px-3 py-2.5 font-mono text-[9px] uppercase tracking-[0.14em] transition-all duration-200",
                  layout === mode ? "bg-ember-faint text-ember-hi shadow-hairline" : "text-stone hover:bg-soot hover:text-bone",
                ].join(" ")}
                onClick={() => onLayoutChange(mode)}
              >
                {mode}
              </button>
            ))}
          </div>
        </section>
      )}
      {onToggleSoloDocuments && (
        <section className="fx-rise-sm flex flex-col gap-2.5" style={riseDelay(0.24)}>
          <p className="font-mono text-[9px] uppercase tracking-[0.26em] text-faint">Documents</p>
          <button
            className={[
              "flex items-center justify-between rounded-2xl border px-3.5 py-3 text-left transition-all duration-200",
              soloDocumentsOnly ? "border-ember/45 bg-ember-faint" : "border-line hover:border-line-strong",
            ].join(" ")}
            onClick={onToggleSoloDocuments}
          >
            <span className="text-[13px] text-bone">Solo documents only</span>
            <span
              className={[
                "grid h-5 w-5 place-items-center rounded-full border transition-all duration-200",
                soloDocumentsOnly ? "border-ember bg-ember text-[#2A1708]" : "border-line-strong bg-transparent",
              ].join(" ")}
            >
              {soloDocumentsOnly && <span className="h-1.5 w-1.5 rounded-full bg-[#2A1708]" />}
            </span>
          </button>
        </section>
      )}
    </div>
  );
}

export function GraphFilters({
  variant = "inline",
  open = false,
  onClose,
  ...contentProps
}: GraphFiltersProps) {
  if (variant === "inline") {
    return <GraphFiltersContent {...contentProps} />;
  }
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 767px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(media.matches);
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const activeCount =
    contentProps.activeTypes.length +
    (contentProps.linkFilter && contentProps.linkFilter !== "all" ? 1 : 0) +
    (contentProps.showBridges ? 1 : 0);
  const countLabel = activeCount > 0 ? `${activeCount} active` : "all memories";
  if (!open) return null;

  return createPortal(
    <>
      <div className="cortex-scrim open" onClick={onClose} aria-hidden="true" />
      {!isMobile && <div className="cortex-popover open" role="dialog" aria-modal="true" aria-label="Cortex filters">
        <div className="cortex-popover-panel">
          <div className="cortex-popover-head">
            <div className="flex items-center gap-2">
              <span className="cortex-popover-title">Cortex filters</span>
              <span className="cortex-sheet-count">{countLabel}</span>
            </div>
            <button className="cortex-popover-close" onClick={onClose} aria-label="Close filters">
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="cortex-popover-body">
            <GraphFiltersContent {...contentProps} />
          </div>
        </div>
      </div>}
      {isMobile && <aside className="cortex-sheet open" aria-label="Cortex filters">
        <span className="cortex-sheet-grabber shrink-0" />
        <div className="cortex-sheet-head shrink-0">
          <span className="cortex-sheet-title">Filters</span>
          <span className="cortex-sheet-count">{countLabel}</span>
          <button className="cortex-sheet-close" onClick={onClose} aria-label="Close filters">
            <Icon name="close" size={15} />
          </button>
        </div>
        <div className="cortex-list flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
          <div className="flex flex-col gap-5 pb-2 pt-1">
            <GraphFiltersContent {...contentProps} />
          </div>
        </div>
      </aside>}
    </>,
    document.body
  );
}
