import { useEffect, useRef, useState, type CSSProperties } from "react";
import { DocumentUpload } from "../components/documents/DocumentUpload";
import { PipelineRail } from "../components/documents/PipelineRail";
import { DocumentList } from "../components/documents/DocumentList";
import { DocumentViewer } from "../components/documents/DocumentViewer";
import { useDocuments } from "../hooks/useDocuments";
import { useJobPolling } from "../hooks/useJobPolling";
import { useStats } from "../hooks/useStats";
import { formatBytes } from "../utils/format";
import type { UploadAccepted } from "../types";

function CountUp({
  value,
  format,
}: {
  value: number | null;
  format?: (n: number) => string;
}) {
  const [display, setDisplay] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    if (value === null) return;
    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }
    const duration = 900;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(from + (to - from) * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        fromRef.current = to;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  if (value === null) return <>—</>;
  return <>{format ? format(display) : Math.round(display).toLocaleString("en-US")}</>;
}

const DORMANT_STEPS = [
  "parse",
  "structure",
  "extract",
  "store",
  "embed",
  "buckets",
  "index",
];

function DormantRail() {
  return (
    <div className="flex h-full flex-col">
      <div className="relative flex-1 py-1">
        <div
          className="absolute left-[13px] top-3.5 w-px bg-line-strong"
          style={{ bottom: "14px" }}
        />
        <ol className="relative z-10">
          {DORMANT_STEPS.map((step, i) => {
            const last = i === DORMANT_STEPS.length - 1;
            return (
              <li
                key={step}
                className={`relative flex items-center gap-3.5 ${last ? "" : "pb-[16px]"
                  }`}
              >
                <span className="relative z-10 flex h-7 w-7 flex-none items-center justify-center rounded-full border border-line-strong bg-coal">
                  <span
                    className={`h-2 w-2 rounded-full ${i === 0
                      ? "fx-breathe bg-ember/50 shadow-[0_0_8px_rgba(255,138,61,0.4)]"
                      : "bg-stone/25"
                      }`}
                  />
                </span>
                <span className="t-mono text-[9px] uppercase tracking-[0.2em] text-stone/40">
                  {step}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <div className="flex flex-col items-center gap-2 border-t border-line pt-4 text-center">
        <svg
          width="30"
          height="30"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          className="text-stone/40"
        >
          <path d="M12 16V5m0 0 4 4m-4-4L8 9" />
          <path d="M5 16v2.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V16" />
        </svg>
        <p className="t-mono text-[9px] uppercase tracking-[0.22em] text-stone/50">
          awaiting ignition
        </p>
      </div>
    </div>
  );
}

export function ArchivePage() {
  const { documents, storage, loading, upload, remove, refetch } = useDocuments();
  const { stats } = useStats();
  const [jobId, setJobId] = useState<string | null>(null);
  const [activeDocId, setActiveDocId] = useState<string | null>(null);

  const { job, polling } = useJobPolling(jobId, (finished) => {
    if (finished.status === "complete" || finished.status === "duplicate") {
      void refetch();
    }
  });

  const handleUploaded = (accepted: UploadAccepted) => {
    setJobId(accepted.jobId);
  };

  const handleDelete = (documentId: string) => {
    if (activeDocId === documentId) setActiveDocId(null);
    remove(documentId);
  };

  const activeSummary = documents.find((d) => d.documentId === activeDocId) ?? null;

  const ribbon = [
    { label: "documents", value: documents.length, tone: "" },
    { label: "memories", value: stats?.totalBuckets ?? null, tone: "hot" },
    { label: "synapses", value: stats?.totalRelationships ?? null, tone: "cold" },
    {
      label: "vault weight",
      value: storage?.totalSizeBytes ?? null,
      tone: "",
      format: (n: number) => formatBytes(n),
    },
  ];

  return (
    <div className="page">
      <span className="archive-aura" aria-hidden="true" />
      <div className="relative z-10 page-narrow">
        <header className="page-head">
          <p className="kicker">Document ingestion</p>
          <h1 className="page-title">
            Feed the <em>graph.</em>
          </h1>
          <p className="page-sub">
            One upload, one extraction pass — <b>forever retrievable</b>. Each document is
            distilled into concepts, embedded, and wired into the living network.
          </p>
        </header>

        <div
          className="fx-rise mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3"
          style={{ "--rise-delay": "0.06s" } as CSSProperties}
        >
          {ribbon.map((tile) => (
            <div key={tile.label} className={`stat-tile ${tile.tone}`}>
              <p className="stat-tile-label">{tile.label}</p>
              <p className="stat-tile-value">
                <CountUp value={tile.value} format={tile.format} />
              </p>
            </div>
          ))}
        </div>

        <div
          className="fx-rise grid gap-3 lg:grid-cols-2"
          style={{ "--rise-delay": "0.12s" } as CSSProperties}
        >
          <DocumentUpload onUploaded={handleUploaded} upload={upload} />
          <div className="panel panel-pad flex flex-col">
            <p className="panel-title mb-3">Ingestion pipeline</p>
            <div className="flex-1">
              {job ? (
                <PipelineRail job={job} polling={polling} />
              ) : (
                <DormantRail />
              )}
            </div>
          </div>
        </div>

        <div
          className="fx-rise mt-4"
          style={{ "--rise-delay": "0.24s" } as CSSProperties}
        >
          <DocumentList
            documents={documents}
            storage={storage}
            loading={loading}
            onDelete={handleDelete}
            onOpen={setActiveDocId}
            activeId={activeDocId}
          />
        </div>
      </div>

      <DocumentViewer
        documentId={activeDocId}
        summary={activeSummary}
        onClose={() => setActiveDocId(null)}
      />
    </div>
  );
}