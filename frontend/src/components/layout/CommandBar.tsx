import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Icon } from "../shared/Icon";
import { api } from "../../api";
import { useCortexBridge } from "../../hooks/useCortexBridge";
import { useDebounce } from "../../hooks/useDebounce";
import { CONCEPT_TYPES } from "../../constants";
import type { DocumentSummary, MemorySummary } from "../../types";

interface CommandBarProps {
  onJumpToMemory: (bucketId: string) => void;
  onJumpToDocument?: (documentId: string) => void;
  open?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

type SearchResult =
  | {
    kind: "document";
    id: string;
    title: string;
    subtitle: string;
  }
  | {
    kind: "memory";
    id: string;
    title: string;
    subtitle: string;
    conceptType: MemorySummary["conceptType"];
    strength: number;
  };

export function CommandBar({
  onJumpToMemory,
  onJumpToDocument,
  open,
  onOpen,
  onClose,
}: CommandBarProps) {
  const controlled = typeof open === "boolean";

  const { highlight, clearHighlight, setRetrieving } = useCortexBridge();

  const [selfOpen, setSelfOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [memoryResults, setMemoryResults] = useState<MemorySummary[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);

  const desktopInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const debounced = useDebounce(query, 260);
  const visible = controlled ? Boolean(open) : selfOpen;

  const requestOpen = useCallback(() => {
    if (controlled) onOpen?.();
    else setSelfOpen(true);
  }, [controlled, onOpen]);

  const requestClose = useCallback(() => {
    if (controlled) onClose?.();
    else setSelfOpen(false);

    setQuery("");
    setMemoryResults([]);
    clearHighlight();
    desktopInputRef.current?.blur();
    mobileInputRef.current?.blur();
  }, [controlled, onClose, clearHighlight]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");

    const apply = () => setIsMobile(media.matches);

    apply();
    media.addEventListener?.("change", apply);

    return () => media.removeEventListener?.("change", apply);
  }, []);

  useEffect(() => {
    let cancelled = false;

    api.documents
      .list()
      .then((response) => {
        if (!cancelled) setDocuments(response.documents);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        requestOpen();
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        requestOpen();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestOpen]);

  useEffect(() => {
    const term = debounced.trim();

    if (!term) {
      setMemoryResults([]);
      setSearching(false);
      setRetrieving(false);
      clearHighlight();

      if (!controlled) setSelfOpen(false);

      return;
    }

    let cancelled = false;

    setSearching(true);
    setRetrieving(true);

    api.memories
      .list({ search: term, limit: 6 })
      .then((response) => {
        if (cancelled) return;

        setMemoryResults(response.memories);

        if (!controlled) setSelfOpen(true);

        highlight(response.memories.map((memory) => memory.bucketId));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setSearching(false);
          setRetrieving(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debounced, controlled, highlight, clearHighlight, setRetrieving]);

  useEffect(() => {
    if (!visible) return;

    const timer = window.setTimeout(() => {
      if (isMobile) mobileInputRef.current?.focus();
      else desktopInputRef.current?.focus();
    }, 70);

    return () => window.clearTimeout(timer);
  }, [visible, isMobile]);

  const documentResults = useMemo<SearchResult[]>(() => {
    const term = debounced.trim().toLowerCase();

    if (!term || !onJumpToDocument) return [];

    return documents
      .filter((document) => document.filename.toLowerCase().includes(term))
      .slice(0, 4)
      .map((document) => ({
        kind: "document",
        id: document.documentId,
        title: document.filename,
        subtitle: `${document.fileType.toUpperCase()} document`,
      }));
  }, [documents, debounced, onJumpToDocument]);

  const memorySearchResults = useMemo<SearchResult[]>(
    () =>
      memoryResults.map((memory) => ({
        kind: "memory",
        id: memory.bucketId,
        title: memory.canonical,
        subtitle: `${CONCEPT_TYPES[memory.conceptType]?.label ?? memory.conceptType} · ${Math.round(
          memory.strength * 100
        )}%`,
        conceptType: memory.conceptType,
        strength: memory.strength,
      })),
    [memoryResults]
  );

  const flatResults = useMemo(
    () => [...documentResults, ...memorySearchResults],
    [documentResults, memorySearchResults]
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [flatResults.length]);

  useEffect(() => {
    if (!visible) return;

    const element = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    element?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, visible, flatResults.length]);

  const commit = useCallback(
    (result: SearchResult) => {
      if (result.kind === "document") onJumpToDocument?.(result.id);
      else onJumpToMemory(result.id);

      requestClose();
    },
    [onJumpToDocument, onJumpToMemory, requestClose]
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();

        const target = flatResults[activeIndex] ?? flatResults[0];

        if (target) commit(target);

        return;
      }

      if (event.key === "Escape") {
        requestClose();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => Math.min(flatResults.length - 1, current + 1));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
      }
    },
    [flatResults, activeIndex, commit, requestClose]
  );

  const renderInput = (inputRef: RefObject<HTMLInputElement>) => (
    <div className="flex items-center gap-3 rounded-2xl border border-line-strong bg-[linear-gradient(180deg,#1B1512_0%,#14100D_100%)] px-4 py-2.5 shadow-hairline transition-all duration-200 focus-within:border-mineral/45 focus-within:shadow-[0_0_0_4px_var(--mineral-faint),0_0_34px_-8px_var(--mineral-glow)]">
      <span className="flex-none text-stone">
        <Icon name="search" size={17} />
      </span>

      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Search documents and memories…"
        aria-label="Search documents and memories"
        className="w-full min-w-0 flex-1 border-none bg-transparent text-[15px] font-light text-bone outline-none placeholder:text-[#6B5F54]"
      />

      {searching && (
        <span className="t-mono flex-none text-[9px] uppercase tracking-[0.2em] text-mineral">
          scanning
        </span>
      )}

      <span className="hidden flex-none rounded-md border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#6B5F54] sm:inline-block">
        ⌘K
      </span>
    </div>
  );

  const resultsBody = (
    <>
      {flatResults.length > 0 ? (
        <div ref={listRef} className="max-h-[320px] overflow-y-auto overscroll-contain p-2">
          {flatResults.map((result, index) => {
            const active = index === activeIndex;

            return (
              <button
                key={`${result.kind}:${result.id}`}
                className={[
                  "group flex w-full items-center gap-3 rounded-[18px] border px-3.5 py-3 text-left transition-all duration-200",
                  active
                    ? "border-ember/35 bg-ember-faint shadow-ember"
                    : "border-transparent hover:bg-soot",
                ].join(" ")}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => commit(result)}
              >
                {result.kind === "document" ? (
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-[14px] border border-line-strong bg-coal text-ember-hi">
                    <Icon name="archive" size={16} />
                  </span>
                ) : (
                  <span className="grid h-9 w-9 flex-none place-items-center rounded-[14px] border border-line-strong bg-coal">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{
                        background: CONCEPT_TYPES[result.conceptType]?.color,
                        boxShadow: `0 0 10px ${CONCEPT_TYPES[result.conceptType]?.color}`,
                      }}
                    />
                  </span>
                )}

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-bone">{result.title}</span>

                  <span className="t-mono mt-1 block text-[9px] uppercase tracking-[0.16em] text-stone">
                    {result.subtitle}
                  </span>
                </span>

                <Icon
                  name="send"
                  size={14}
                  className={[
                    "transition-all duration-200",
                    active
                      ? "translate-x-0 text-ember-hi opacity-100"
                      : "-translate-x-1 text-stone opacity-0",
                  ].join(" ")}
                />
              </button>
            );
          })}
        </div>
      ) : searching ? (
        <div className="flex items-center justify-center gap-3 px-5 py-8">
          <span className="h-2 w-2 animate-ping rounded-full bg-mineral" />
          <span className="t-mono text-[10px] uppercase tracking-[0.22em] text-mineral">
            scanning graph
          </span>
        </div>
      ) : (
        <div className="px-6 py-10 text-center">
          <p className="font-display text-lg font-medium text-bone">
            {query.trim() ? "No matches" : "Search your memory universe"}
          </p>

          <p className="mt-2 text-[13px] font-light leading-relaxed text-stone">
            {query.trim()
              ? "No document or memory matches this query yet."
              : "Find documents and concepts, then jump straight to them."}
          </p>
        </div>
      )}
    </>
  );

  if (!visible) return null;

  if (isMobile) {
    return (
      <>
        <div
          className="fixed inset-0 z-[65] bg-void/60 backdrop-blur-[2px] md:hidden"
          onClick={requestClose}
        />

        <aside
          className="fx-sheet-in fixed inset-x-0 bottom-0 z-[66] flex max-h-[80vh] flex-col gap-3 rounded-t-[26px] border-t border-line-strong bg-[linear-gradient(180deg,#15100D_0%,#0E0B09_100%)] px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-2 shadow-lift md:hidden"
          style={{ bottom: "var(--kb, 0px)" }}
          aria-hidden={!visible}
        >
          <span className="mx-auto mt-1 h-1 w-10 flex-none rounded-full bg-line-strong" />

          <div className="flex items-center justify-between gap-3">
            <span className="t-mono text-[10px] uppercase tracking-[0.24em] text-stone">
              Search
            </span>

            <button
              className="grid h-9 w-9 place-items-center rounded-xl text-stone transition-all duration-200 hover:bg-soot hover:text-bone"
              onClick={requestClose}
              aria-label="Close search"
            >
              <Icon name="close" size={15} />
            </button>
          </div>

          {renderInput(mobileInputRef)}

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{resultsBody}</div>
        </aside>
      </>
    );
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(84px+env(safe-area-inset-top))] z-[66] hidden justify-center md:flex">
      <div className="pointer-events-auto fx-popover-in relative w-[min(640px,calc(100vw-48px))] overflow-hidden rounded-3xl border border-line-strong bg-coal/90 shadow-lift backdrop-blur-2xl">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-mineral/45 to-transparent" />

        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <span className="t-mono text-[9px] uppercase tracking-[0.24em] text-stone">
            Memory search
          </span>

          {searching ? (
            <span className="t-mono flex items-center gap-2 text-[9px] uppercase tracking-[0.2em] text-mineral">
              <span className="h-1.5 w-1.5 animate-ping rounded-full bg-mineral" />
              scanning
            </span>
          ) : (
            <button
              className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-[#6B5F54] transition-colors hover:bg-soot hover:text-bone"
              onClick={requestClose}
            >
              esc
            </button>
          )}
        </div>

        <div className="p-2">{renderInput(desktopInputRef)}</div>

        {resultsBody}
      </div>
    </div>
  );
}