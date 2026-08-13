import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Icon } from "../shared/Icon";
import { MAX_UPLOAD_BYTES } from "../../constants";
import { formatBytes } from "../../utils/format";
import type { UploadAccepted } from "../../types";

interface DocumentUploadProps {
  upload: (file: File, sessionId?: string) => Promise<UploadAccepted>;
  onUploaded: (accepted: UploadAccepted) => void;
}

const ACCEPTED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".doc",
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".json",
  ".csv",
  ".html",
  ".py",
  ".ts",
  ".js",
  ".yaml",
  ".yml",
];

export function DocumentUpload({ upload, onUploaded }: DocumentUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validate = (file: File): string | null => {
    const dot = file.name.lastIndexOf(".");
    const ext = dot === -1 ? "" : file.name.substring(dot).toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) return `Unsupported format "${ext || "unknown"}"`;
    if (file.size === 0) return "File is empty";
    if (file.size > MAX_UPLOAD_BYTES) return `Exceeds ${formatBytes(MAX_UPLOAD_BYTES)}`;
    return null;
  };

  const handleFile = async (file: File) => {
    setError(null);
    const problem = validate(file);
    if (problem) {
      setError(problem);
      return;
    }
    setUploading(true);
    setFileName(file.name);
    try {
      const accepted = await upload(file);
      onUploaded(accepted);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setFileName(null);
    }
  };

  const handleMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = dropRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--gx", `${event.clientX - rect.left}px`);
    el.style.setProperty("--gy", `${event.clientY - rect.top}px`);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void handleFile(file);
    event.target.value = "";
  };

  return (
    <div className="panel panel-pad flex flex-col">
      <p className="panel-title mb-3">New ingestion</p>

      <div
        ref={dropRef}
        role="button"
        tabIndex={0}
        aria-label="Upload a document"
        className={`ingest-drop ${dragging ? "drag" : ""}`}
        onMouseMove={handleMove}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <svg
          className="ingest-ants"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          fill="none"
          aria-hidden="true"
        >
          <rect
            x="1"
            y="1"
            width="98"
            height="98"
            rx="6"
            stroke={dragging ? "rgba(255, 138, 61, 0.7)" : "rgba(255, 138, 61, 0.22)"}
            strokeWidth="0.6"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
            className="fx-dash"
          />
        </svg>

        {uploading && <div className="fx-scanline" />}

        <span
          className={`relative z-10 flex h-14 w-14 items-center justify-center rounded-2xl border transition-all duration-300 ${dragging || uploading
            ? "border-ember/50 bg-ember-faint text-ember"
            : "border-line-strong bg-coal text-stone"
            }`}
        >
          <Icon
            name="upload"
            size={24}
            className={uploading ? "fx-breathe" : dragging ? "-translate-y-1" : ""}
          />
        </span>

        {uploading ? (
          <div className="relative z-10 flex flex-col items-center gap-2 text-center">
            <p className="max-w-full truncate font-display text-xl font-medium text-bone">
              {fileName}
            </p>
            <p className="t-mono text-[9.5px] uppercase tracking-[0.24em] text-mineral">
              extracting — one pass, forever retrievable
            </p>
          </div>
        ) : (
          <div className="relative z-10 flex flex-col items-center gap-2 text-center">
            <p className="font-display text-2xl font-medium text-bone">
              {dragging ? (
                <>
                  Release to <em className="font-normal italic text-ember-hi">ignite.</em>
                </>
              ) : (
                <>
                  Feed the <em className="font-normal italic text-ember-hi">archive.</em>
                </>
              )}
            </p>
            <p className="t-mono text-[9.5px] uppercase tracking-[0.2em] text-stone">
              click to browse · pdf docx md txt code · 4 mb max
            </p>
          </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS.join(",")}
        className="hidden"
        onChange={handleChange}
      />

      {error && <p className="field-error fx-rise mt-3">{error}</p>}

      <p className="t-mono mt-3 text-[9px] uppercase tracking-[0.18em] text-stone/50">
        one extraction pass per document · retrieval is free forever
      </p>
    </div>
  );
}