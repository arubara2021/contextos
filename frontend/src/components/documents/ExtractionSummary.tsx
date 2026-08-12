import type { CSSProperties } from "react";
import { formatMs } from "../../utils/format";
import type { IngestionJobResult } from "../../types";

interface ExtractionSummaryProps {
  result: IngestionJobResult | null;
}

export function ExtractionSummary({ result }: ExtractionSummaryProps) {
  if (!result) return null;

  const tiles = [
    { label: "concepts", value: String(result.conceptsExtracted) },
    { label: "new memories", value: String(result.newBuckets) },
    { label: "merged", value: String(result.mergedBuckets) },
    { label: "embeddings", value: String(result.embeddingsGenerated) },
    { label: "duration", value: formatMs(result.durationMs) },
  ];

  return (
    <div className="fx-rise mt-2 rounded-xl border border-moss/30 bg-moss/5 p-4">
      <p className="t-mono mb-3 text-[9px] uppercase tracking-[0.24em] text-moss">
        Extraction complete
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {tiles.map((tile, index) => (
          <div
            key={tile.label}
            className="fx-rise rounded-lg border border-line bg-coal px-3 py-2.5"
            style={{ "--rise-delay": `${index * 0.06}s` } as CSSProperties}
          >
            <p className="font-display text-lg font-medium leading-none text-ember-hi">
              {tile.value}
            </p>
            <p className="t-mono mt-1.5 text-[8px] uppercase tracking-[0.16em] text-stone/60">
              {tile.label}
            </p>
          </div>
        ))}
      </div>
      {result.errors.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          {result.errors.map((errorMessage, index) => (
            <p key={index} className="text-[11.5px] font-light text-flare">
              {errorMessage}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}