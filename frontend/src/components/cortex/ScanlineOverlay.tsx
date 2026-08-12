interface ScanlineOverlayProps {
  active: boolean;
}

export function ScanlineOverlay({ active }: ScanlineOverlayProps) {
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-hud overflow-hidden">
      <div className="fx-sweep" />
      <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-full border border-mineral/40 bg-mineral-faint px-4 py-1.5 t-mono text-[9px] uppercase tracking-[0.3em] text-mineral">
        scanning memory field
      </div>
    </div>
  );
}