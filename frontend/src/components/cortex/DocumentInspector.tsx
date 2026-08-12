import { useEffect, useRef } from "react";
import { Icon } from "../shared/Icon";
import type { CortexDocumentNode } from "../../types";
import { formatFull } from "../../utils/date";

interface DocumentInspectorProps {
  document: CortexDocumentNode | null;
  onClose: () => void;
  onOpenDocument: (documentId: string) => void;
  onJumpToConcept?: (bucketId: string) => void;
  onJumpToDocument?: (documentId: string) => void;
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-coal/70 px-3.5 py-3">
      <p className="t-mono text-[8px] uppercase tracking-[0.22em] text-stone">{label}</p>
      <p className={`mt-1 font-display text-xl ${accent ? "text-ember-hi" : "text-bone"}`}>
        {value}
      </p>
    </div>
  );
}

export function DocumentInspector({
  document,
  onClose,
  onOpenDocument,
  onJumpToConcept,
  onJumpToDocument,
}: DocumentInspectorProps) {
  const open = document !== null;

  const lastDocumentRef = useRef(document);
  if (document) lastDocumentRef.current = document;

  const shown = document ?? lastDocumentRef.current;

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!shown) return null;

  return (
    <>
      <div className={`inspector-veil ${open ? "open" : ""}`} onClick={onClose} />

      <aside className={`inspector ${open ? "open" : ""}`} aria-hidden={!open}>
        <div className="inspector-head">
          <span className="type-badge" data-type="entity">
            Document
          </span>

          <span className="ml-auto" />

          <button className="inspector-close" onClick={onClose} aria-label="Close document panel">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="px-6 pt-4">
          <p className="t-mono text-[8px] uppercase tracking-[0.28em] text-stone">
            Document node
          </p>

          <h2 className="inspector-name">{shown.filename}</h2>

          <p className="inspector-def">
            {shown.fileType.toUpperCase()} · uploaded {formatFull(shown.uploadedAt)}
          </p>
        </div>

        <div className="inspector-scroll">
          <section>
            <p className="insp-section-label">Field summary</p>

            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Memories" value={shown.conceptCount} />
              <StatTile label="Linked" value={shown.connectedConceptCount} accent />
              <StatTile label="Islands" value={shown.isolatedConceptCount} />
              <StatTile label="Related files" value={shown.relatedDocuments.length} />
            </div>
          </section>

          {shown.solo && (
            <section>
              <p className="insp-section-label">Solo document</p>

              <div className="rounded-2xl border border-dashed border-line-strong bg-soot/40 px-4 py-4">
                <p className="text-[13px] font-light leading-relaxed text-stone">
                  This document has no cross-document links yet. Upload related
                  documents or chat about this file to grow connections.
                </p>
              </div>
            </section>
          )}

          {shown.topConcepts.length > 0 && (
            <section>
              <p className="insp-section-label">Top concepts</p>

              <div className="flex flex-col gap-1">
                {shown.topConcepts.map((concept, index) => (
                  <button
                    key={concept.bucketId}
                    className="conn-row"
                    onClick={() => onJumpToConcept?.(concept.bucketId)}
                  >
                    <span className="conn-glyph">{index + 1}</span>
                    <span className="conn-name">{concept.canonical}</span>
                    <span className="conn-type">open</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {shown.relatedDocuments.length > 0 && (
            <section>
              <p className="insp-section-label">Related documents</p>

              <div className="flex flex-col gap-1">
                {shown.relatedDocuments.map((related) => (
                  <button
                    key={related.documentId}
                    className="conn-row"
                    onClick={() => onJumpToDocument?.(related.documentId)}
                  >
                    <span className="conn-glyph">↔</span>
                    <span className="conn-name">{related.filename}</span>
                    <span className="conn-type">{related.sharedConcepts} shared</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="inspector-foot">
          <button
            className="reignite-btn"
            onClick={() => onOpenDocument(shown.documentId)}
          >
            Open document graph
          </button>

          <button className="btn btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
      </aside>
    </>
  );
}