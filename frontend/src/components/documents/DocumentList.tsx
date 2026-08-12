import { useState } from "react";
import { Icon } from "../shared/Icon";
import { formatBytes } from "../../utils/format";
import { relativeTime } from "../../utils/date";
import type { DocumentSummary } from "../../types";

interface DocumentListProps {
  documents: DocumentSummary[];
  storage: { totalSizeBytes: number; totalSizeMB: number; objectCount: number } | null;
  loading: boolean;
  onDelete: (documentId: string) => void;
  onOpen: (documentId: string) => void;
  activeId: string | null;
}

export const TYPE_COLORS: Record<string, string> = {
  ".pdf": "#FF8A3D",
  ".docx": "#86B4E8",
  ".doc": "#86B4E8",
  ".md": "#8FD8D2",
  ".markdown": "#8FD8D2",
  ".txt": "#A29384",
  ".json": "#F4D06F",
  ".csv": "#9DB98A",
  ".html": "#E39AB8",
  ".py": "#9DB98A",
  ".ts": "#8FD8D2",
  ".js": "#F4D06F",
};

export function getDocExt(fileType: string): string {
  const e = fileType && fileType.startsWith(".") ? fileType.toLowerCase() : `.${(fileType || "").toLowerCase()}`;
  return e && e.length > 1 ? e : ".file";
}

export function getDocColor(fileType: string): string {
  return TYPE_COLORS[getDocExt(fileType)] ?? "#A29384";
}

export function DocumentList({ documents, storage, loading, onDelete, onOpen, activeId }: DocumentListProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleDelete = (documentId: string) => {
    if (confirmingId === documentId) {
      onDelete(documentId);
      setConfirmingId(null);
      return;
    }
    setConfirmingId(documentId);
    window.setTimeout(
      () => setConfirmingId((current) => (current === documentId ? null : current)),
      2600
    );
  };

  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <span className="panel-title">The vault · {documents.length}</span>
        {storage && (
          <span className="t-mono text-[9px] uppercase tracking-[0.18em] text-stone">
            {formatBytes(storage.totalSizeBytes)} · {storage.objectCount} objects
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-4 px-5 py-5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <span className="h-9 w-9 flex-none animate-pulse rounded-lg bg-soot" />
              <div className="flex-1">
                <div className="h-3.5 w-1/3 animate-pulse rounded bg-soot" />
                <div className="mt-2 h-2.5 w-1/5 animate-pulse rounded bg-soot" />
              </div>
            </div>
          ))}
        </div>
      ) : documents.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="empty-glyph">
            <Icon name="archive" size={24} />
          </span>
          <p className="font-display text-lg font-medium text-bone">The vault is empty</p>
          <p className="max-w-xs text-[13px] font-light leading-relaxed text-stone">
            Every document you feed becomes a constellation of memories in the graph.
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {documents.map((doc) => {
            const ext = getDocExt(doc.fileType);
            const color = getDocColor(doc.fileType);
            const confirming = confirmingId === doc.documentId;
            const isActive = activeId === doc.documentId;
            return (
              <div
                key={doc.documentId}
                role="button"
                tabIndex={0}
                aria-label={`Open ${doc.filename}`}
                onClick={() => onOpen(doc.documentId)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onOpen(doc.documentId);
                  }
                }}
                className={`vault-row group flex items-center gap-3 border-b border-line px-4 py-3 transition-colors last:border-b-0 hover:bg-soot/60 focus-visible:bg-soot/60 sm:gap-4 sm:px-5 sm:py-3.5 ${isActive ? "is-open" : ""
                  }`}
                style={{ ["--spine" as string]: color }}
              >
                <span
                  className="t-mono flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-line-strong bg-coal text-[7px] uppercase transition-shadow duration-300 group-hover:shadow-[0_0_14px_-4px_var(--spine)] sm:h-9 sm:w-9 sm:text-[8px]"
                  style={{ color }}
                >
                  {ext.replace(".", "")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] text-bone sm:text-[13.5px]">{doc.filename}</p>
                  <p className="t-mono mt-0.5 text-[8.5px] uppercase tracking-[0.14em] text-stone/50 sm:text-[9px]">
                    ingested {relativeTime(doc.uploadedAt)}
                  </p>
                </div>
                <span className="vault-open" aria-hidden="true">
                  <Icon name="chevron" size={15} />
                </span>
                <button
                  className={`vault-del btn btn-sm ${confirming ? "btn-danger" : "btn-ghost"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(doc.documentId);
                  }}
                  aria-label={`Delete ${doc.filename}`}
                >
                  <Icon name="trash" size={12} />
                  {confirming && "Sure?"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}