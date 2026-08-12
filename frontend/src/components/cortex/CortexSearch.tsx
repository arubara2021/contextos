import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../shared/Icon";
import { CONCEPT_TYPES } from "../../constants";
import { matchesQuery } from "../../utils/search";
import type { MemorySummary } from "../../types";

interface SearchDocument {
  documentId: string;
  filename: string;
  conceptCount?: number;
}

interface CortexSearchProps {
  open: boolean;
  query: string;
  searching: boolean;
  memories: MemorySummary[];
  documents: SearchDocument[];
  onQueryChange: (value: string) => void;
  onClose: () => void;
  onSelectMemory: (bucketId: string) => void;
  onSelectDocument: (documentId: string) => void;
}

type SearchItem =
  | { kind: "document"; document: SearchDocument }
  | { kind: "memory"; memory: MemorySummary };

export function CortexSearch({
  open,
  query,
  searching,
  memories,
  documents,
  onQueryChange,
  onClose,
  onSelectMemory,
  onSelectDocument,
}: CortexSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const term = query.trim();

  const documentMatches = useMemo(() => {
    const seen = new Set<string>();
    return documents
      .filter((doc) => !term || matchesQuery(doc.filename, term))
      .filter((doc) => {
        if (seen.has(doc.documentId)) return false;
        seen.add(doc.documentId);
        return true;
      })
      .slice(0, 5);
  }, [documents, term]);

  const memoryMatches = useMemo(() => {
    const seen = new Set<string>();
    return memories.filter((memory) => {
      if (seen.has(memory.bucketId)) return false;
      seen.add(memory.bucketId);
      return true;
    });
  }, [memories]);

  const items = useMemo<SearchItem[]>(
    () => [
      ...documentMatches.map((document) => ({ kind: "document" as const, document })),
      ...(term ? memoryMatches : []).map((memory) => ({ kind: "memory" as const, memory })),
    ],
    [documentMatches, memoryMatches, term]
  );

  // Focus input when opening
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Reset active index on query change
  useEffect(() => {
    setActive(0);
  }, [term, open]);

  // Clamp active index
  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Scroll active item into view
  useEffect(() => {
    bodyRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const selectItem = (item: SearchItem) => {
    if (item.kind === "document") onSelectDocument(item.document.documentId);
    else onSelectMemory(item.memory.bucketId);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, Math.max(0, items.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      const item = items[active] ?? items[0];
      if (item) {
        event.preventDefault();
        selectItem(item);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  // A closed search must not remain in the portal. It otherwise leaves stale
  // responsive UI behind after switching between desktop and mobile widths.
  if (!open) return null;

  let cursor = -1;

  return createPortal(
    <>
      <div
        className={`csearch-scrim ${open ? "open" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`csearch ${open ? "open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Search your knowledge graph"
      >
        <div className="csearch-head">
          <button
            className="csearch-back"
            onClick={onClose}
            aria-label="Close search"
          >
            <Icon name="back" size={18} />
          </button>
          <span className="csearch-icon">
            <Icon name="search" size={18} />
          </span>
          <input
            ref={inputRef}
            className="csearch-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search memories, documents, concepts…"
            aria-label="Search memories"
            tabIndex={open ? 0 : -1}
            enterKeyHint="search"
          />
          {term ? (
            <button
              className="csearch-clear"
              onClick={() => {
                onQueryChange("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <Icon name="close" size={14} />
            </button>
          ) : (
            <span className="csearch-esc">esc</span>
          )}
        </div>

        <div className="csearch-body" ref={bodyRef}>
          {searching && (
            <div className="csearch-status">scanning memory field</div>
          )}

          {!term && !searching && (
            <p className="csearch-hintline">
              Jump into a document, or type to scan every memory.
            </p>
          )}

          {documentMatches.length > 0 && (
            <div className="csearch-section">
              <p className="csearch-section-title">
                {term ? "Documents" : "Your documents"}
              </p>
              {documentMatches.map((doc) => {
                cursor += 1;
                const idx = cursor;
                return (
                  <button
                    key={doc.documentId}
                    data-idx={idx}
                    className={`csearch-row ${active === idx ? "is-active" : ""}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => onSelectDocument(doc.documentId)}
                  >
                    <span className="csearch-doc-glyph">
                      <Icon name="archive" size={15} />
                    </span>
                    <span className="csearch-name">{doc.filename}</span>
                    <span className="csearch-meta">
                      {doc.conceptCount ?? 0} mem
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {term && memoryMatches.length > 0 && (
            <div className="csearch-section">
              <p className="csearch-section-title">
                Memories · {memories.length}
              </p>
              {memoryMatches.map((memory) => {
                cursor += 1;
                const idx = cursor;
                const color =
                  CONCEPT_TYPES[memory.conceptType]?.color ?? "#A29384";
                return (
                  <button
                    key={memory.bucketId}
                    data-idx={idx}
                    className={`csearch-row ${active === idx ? "is-active" : ""}`}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => onSelectMemory(memory.bucketId)}
                  >
                    <span
                      className="csearch-dot"
                      style={{
                        background: color,
                        boxShadow: `0 0 8px ${color}`,
                      }}
                    />
                    <span className="csearch-name">{memory.canonical}</span>
                    <span className="csearch-type">
                      {CONCEPT_TYPES[memory.conceptType]?.label ??
                        memory.conceptType}
                    </span>
                    <span className="csearch-strength">
                      {Math.round(memory.strength * 100)}%
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {term &&
            !searching &&
            memoryMatches.length === 0 &&
            documentMatches.length === 0 && (
              <div className="csearch-empty">
                <span className="csearch-empty-icon">
                  <Icon name="search" size={20} />
                </span>
                <p>No memories match &ldquo;{term}&rdquo; yet</p>
              </div>
            )}
        </div>

        <div className="csearch-foot">
          <span>
            <kbd>↑↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> select
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </>,
    document.body
  );
}
