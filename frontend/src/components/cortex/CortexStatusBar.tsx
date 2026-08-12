interface CortexStatusBarDocument {
  filename: string;
  conceptCount: number;
  connectedConceptCount: number;
  isolatedConceptCount: number;
}

interface CortexStatusBarProps {
  totalMemories?: number;
  averageStrength?: number;
  criticalCount?: number;
  documentCount?: number;
  activeDocument?: CortexStatusBarDocument | null;
}

export function CortexStatusBar({
  totalMemories = 0,
  averageStrength = 0,
  criticalCount = 0,
  documentCount = 0,
  activeDocument = null,
}: CortexStatusBarProps) {
  const label = activeDocument
    ? `${activeDocument.filename} · ${activeDocument.conceptCount} memories · ${activeDocument.connectedConceptCount} linked · ${activeDocument.isolatedConceptCount} islands`
    : `${documentCount} files · ${totalMemories} memories · avg ${Math.round(
      averageStrength * 100
    )}% · critical ${criticalCount}`;

  return (
    <div className="pointer-events-none absolute bottom-[calc(18px_+_env(safe-area-inset-bottom))] left-1/2 z-hud hidden -translate-x-1/2 md:block">
      <div className="max-w-[720px] truncate rounded-full border border-line-strong bg-coal/80 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.18em] text-stone shadow-lift backdrop-blur-xl">
        {label}
      </div>
    </div>
  );
}