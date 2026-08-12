import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../shared/Icon";
import { Modal } from "../shared/Modal";
import { api } from "../../api";
import { getDocColor, getDocExt } from "./DocumentList";
import { relativeTime, formatFull } from "../../utils/date";
import { formatBytes } from "../../utils/format";
import { CONCEPT_TYPES } from "../../constants";
import type { DocumentMemoryRef, DocumentSummary } from "../../types";

interface Part {
  text: string;
  hit: boolean;
}

interface VBlock {
  kind: string;
  text?: string;
  id?: string;
  parts?: Part[];
}

interface DocumentViewerProps {
  documentId: string | null;
  summary?: DocumentSummary | null;
  onClose: () => void;
  memories?: DocumentMemoryRef[];
}

function parseBlocks(text: string): VBlock[] {
  const lines = text.split("\n");
  const out: VBlock[] = [];
  let sec = 0;

  for (const line of lines) {
    if (/^\[Page\s+\d+\]\s*$/.test(line)) {
      out.push({ kind: "page" });
      continue;
    }

    const head = line.match(/^##\s+(.+)$/);

    if (head) {
      out.push({ kind: "h2", text: head[1].trim(), id: `doc-sec-${sec++}` });
      continue;
    }

    if (line.trim() === "") {
      out.push({ kind: "blank" });
      continue;
    }

    out.push({ kind: "p", text: line });
  }

  return out;
}

function splitParts(text: string, query: string): Part[] {
  if (!query) return [{ text, hit: false }];

  const low = text.toLowerCase();
  const ql = query.toLowerCase();
  const parts: Part[] = [];

  let i = 0;
  let idx = low.indexOf(ql, 0);

  while (idx !== -1) {
    if (idx > i) parts.push({ text: text.slice(i, idx), hit: false });
    parts.push({ text: text.slice(idx, idx + ql.length), hit: true });
    i = idx + ql.length;
    idx = low.indexOf(ql, i);
  }

  if (i < text.length) parts.push({ text: text.slice(i), hit: false });
  if (parts.length === 0) parts.push({ text, hit: false });

  return parts;
}

export function DocumentViewer({
  documentId,
  summary,
  onClose,
  memories,
}: DocumentViewerProps) {
  const [content, setContent] = useState<string | null>(null);
  const [storedIn, setStoredIn] = useState<string | null>(null);
  const [contentLength, setContentLength] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const activeMarkRef = useRef<HTMLElement | null>(null);

  const setActiveMarkElement = useCallback((el: HTMLElement | null) => {
    activeMarkRef.current = el;
  }, []);

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    setContent(null);

    try {
      const r = await api.documents.content(id);
      const body = r.content || "";

      setContent(body);
      setStoredIn(r.storedIn || null);
      setContentLength(
        typeof r.contentLength === "number" ? r.contentLength : body.length
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load document");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!documentId) {
      setContent(null);
      setStoredIn(null);
      setContentLength(null);
      setError(null);
      setQuery("");
      return;
    }

    setQuery("");
    setTocOpen(false);
    setActiveMatch(0);
    setCopied(false);

    void load(documentId);
  }, [documentId, load]);

  useEffect(() => {
    setActiveMatch(0);
  }, [query]);

  const filename = summary?.filename ?? "(document)";
  const fileType = summary?.fileType ?? "";
  const uploadedAt = summary?.uploadedAt ?? null;
  const ext = getDocExt(fileType);
  const color = getDocColor(fileType);

  const blocks = useMemo<VBlock[]>(
    () => (content ? parseBlocks(content) : []),
    [content]
  );

  const toc = useMemo(() => blocks.filter((b) => b.kind === "h2"), [blocks]);

  const decorated = useMemo<VBlock[]>(
    () =>
      blocks.map((b) =>
        b.kind === "h2" || b.kind === "p"
          ? { ...b, parts: splitParts(b.text || "", query) }
          : b
      ),
    [blocks, query]
  );

  const matchCount = useMemo(
    () =>
      decorated.reduce(
        (n, b) => n + (b.parts ? b.parts.filter((p) => p.hit).length : 0),
        0
      ),
    [decorated]
  );

  const safeActive = matchCount > 0 ? Math.min(activeMatch, matchCount - 1) : -1;

  useEffect(() => {
    if (safeActive >= 0 && activeMarkRef.current) {
      activeMarkRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [safeActive, matchCount]);

  const words = useMemo(
    () =>
      content
        ? content
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0).length
        : 0,
    [content]
  );

  const readMin = Math.max(1, Math.round(words / 200));

  const goSection = (id?: string) => {
    if (!id) return;

    const el = document.getElementById(id);

    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });

    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setTocOpen(false);
    }
  };

  const copyText = async () => {
    if (!content) return;

    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { }
  };

  let markCursor = 0;

  const renderParts = (parts: Part[]) =>
    parts.map((p, i) =>
      p.hit ? (
        <mark
          key={`m-${i}`}
          ref={markCursor === safeActive ? setActiveMarkElement : undefined}
          className={`doc-find-mark${markCursor++ === safeActive ? " is-active" : ""}`}
        >
          {p.text}
        </mark>
      ) : (
        <span key={`t-${i}`}>{p.text}</span>
      )
    );

  const renderBlock = (b: VBlock, i: number) => {
    if (b.kind === "blank") return <div key={i} className="doc-blank" />;

    if (b.kind === "page") {
      return <div key={i} className="doc-page" aria-hidden="true" />;
    }

    if (b.kind === "h2") {
      return (
        <div key={i} id={b.id} className="doc-h2">
          {renderParts(b.parts || [{ text: b.text || "", hit: false }])}
        </div>
      );
    }

    return (
      <div key={i} className="doc-line">
        {renderParts(b.parts || [{ text: b.text || "", hit: false }])}
      </div>
    );
  };

  const stats = [
    {
      label: "stored in",
      value:
        storedIn === "s3"
          ? "S3"
          : storedIn === "database"
            ? "CockroachDB"
            : storedIn || "—",
      tone: "",
    },
    {
      label: "ingested text",
      value: contentLength != null ? formatBytes(contentLength) : "—",
      tone: "cold",
    },
    {
      label: "words",
      value: words ? words.toLocaleString("en-US") : "—",
      tone: "",
    },
    {
      label: "read time",
      value: words ? `${readMin} min` : "—",
      tone: "hot",
    },
  ];

  const hasAside = toc.length > 0;

  return (
    <Modal open={!!documentId} onClose={onClose} width="xl" scroll={false} bodyClassName="p-0">
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-line px-4 py-4 sm:px-6 sm:py-5">
          <div className="flex items-start gap-3">
            <span
              className="t-mono mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-line-strong bg-coal text-[8px] uppercase"
              style={{ color }}
            >
              {ext.replace(".", "")}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg font-medium text-bone sm:text-xl">
                {filename}
              </p>

              <p className="t-mono mt-1 text-[9px] uppercase tracking-[0.16em] text-stone/60">
                {uploadedAt
                  ? `ingested ${relativeTime(uploadedAt)} · ${formatFull(new Date(uploadedAt))}`
                  : "ingested document"}
                {toc.length > 0 ? ` · ${toc.length} sections` : ""}
              </p>
            </div>

            <button
              className="grid h-9 w-9 flex-none place-items-center rounded-lg text-stone transition-colors hover:bg-soot hover:text-bone"
              onClick={onClose}
              aria-label="Close document"
            >
              <Icon name="close" size={16} />
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {stats.map((s) => (
              <div key={s.label} className={`doc-stat ${s.tone}`}>
                <p className="doc-stat-label">{s.label}</p>
                <p className="doc-stat-value">{s.value}</p>
              </div>
            ))}
          </div>

          {memories && memories.length > 0 && (
            <div className="mt-4">
              <p className="t-mono mb-2 text-[8.5px] uppercase tracking-[0.2em] text-stone/50">
                Memories extracted · {memories.length}
              </p>

              <div className="flex gap-2 overflow-x-auto pb-1">
                {memories.map((m) => (
                  <span key={m.bucketId} className="doc-chip flex-none">
                    <span
                      className="h-1.5 w-1.5 flex-none rounded-full"
                      style={{
                        background: CONCEPT_TYPES[m.conceptType]?.color ?? "#A29384",
                      }}
                    />
                    <span className="text-bone/80">{m.canonical}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5 sm:px-6">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
              <Icon name="search" size={14} />
            </span>

            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find in document…"
              className="w-full rounded-lg border border-line bg-coal py-1.5 pl-9 pr-3 text-[13px] text-bone outline-none transition-colors placeholder:text-faint focus:border-line-mineral"
            />
          </div>

          <span className="t-mono hidden flex-none text-[10px] tabular-nums tracking-[0.1em] text-stone sm:inline">
            {query ? `${matchCount > 0 ? safeActive + 1 : 0} / ${matchCount}` : ""}
          </span>

          <button
            className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-line text-stone transition-colors hover:border-line-strong hover:text-bone disabled:opacity-30"
            disabled={matchCount === 0}
            onClick={() => setActiveMatch((m) => (m - 1 + matchCount) % matchCount)}
            aria-label="Previous match"
          >
            <Icon name="chevron" size={14} className="rotate-180" />
          </button>

          <button
            className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-line text-stone transition-colors hover:border-line-strong hover:text-bone disabled:opacity-30"
            disabled={matchCount === 0}
            onClick={() => setActiveMatch((m) => (m + 1) % matchCount)}
            aria-label="Next match"
          >
            <Icon name="chevron" size={14} />
          </button>

          {query && (
            <button
              className="grid h-8 w-8 flex-none place-items-center rounded-lg text-stone transition-colors hover:text-bone"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <Icon name="close" size={13} />
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {hasAside && (
            <aside className="shrink-0 border-b border-line px-4 py-3 lg:w-56 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:py-5">
              <button
                className="t-mono mb-2 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[9px] uppercase tracking-[0.2em] text-stone transition-colors hover:text-bone lg:hidden"
                onClick={() => setTocOpen((v) => !v)}
              >
                <span>Structure · {toc.length}</span>
                <Icon name="chevron" size={13} className={tocOpen ? "rotate-180" : ""} />
              </button>

              <p className="t-mono mb-3 hidden px-2 text-[9px] uppercase tracking-[0.2em] text-stone/50 lg:block">
                Structure
              </p>

              <nav className={`doc-toc ${tocOpen ? "block" : "hidden"} lg:block`}>
                {toc.map((t) => (
                  <button key={t.id} className="doc-toc-link" onClick={() => goSection(t.id)}>
                    {t.text}
                  </button>
                ))}
              </nav>
            </aside>
          )}

          <div className="min-h-0 flex-1 px-4 py-4 lg:overflow-y-auto lg:px-8 lg:py-6">
            {loading && (
              <div className="flex flex-col gap-3">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="h-3 w-2/3 animate-pulse rounded bg-soot" />
                    <div className="h-3 w-full animate-pulse rounded bg-soot/70" />
                    <div className="h-3 w-5/6 animate-pulse rounded bg-soot/70" />
                  </div>
                ))}
              </div>
            )}

            {!loading && error && (
              <div className="flex flex-col items-center gap-3 py-16 text-center">
                <span className="empty-glyph">
                  <Icon name="archive" size={22} />
                </span>

                <p className="font-display text-base text-bone">
                  Couldn’t open the document
                </p>

                <p className="max-w-xs text-[12.5px] font-light text-stone">{error}</p>

                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => documentId && void load(documentId)}
                >
                  <Icon name="refresh" size={12} /> Retry
                </button>
              </div>
            )}

            {!loading && !error && content !== null && (
              <div className="doc-reader">
                {decorated.length === 0 ? (
                  <p className="doc-line text-stone">
                    This document has no extractable text.
                  </p>
                ) : (
                  decorated.map(renderBlock)
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-6">
          <p className="t-mono text-[9px] uppercase tracking-[0.16em] text-stone/50">
            {content !== null ? `${words.toLocaleString("en-US")} words ingested` : "—"}
          </p>

          <div className="flex items-center gap-2">
            <button className="btn btn-sm btn-ghost" onClick={copyText} disabled={!content}>
              <Icon name={copied ? "check" : "copy"} size={12} />
              {copied ? "Copied" : "Copy text"}
            </button>

            <button className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}