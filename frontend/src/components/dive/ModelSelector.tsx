import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../shared/Icon";
import type { ModelInfo } from "../../types";

interface ModelSelectorProps {
  models: ModelInfo[];
  activeKey: string | undefined;
  defaultKey: string | undefined;
  offline?: boolean;
  loading?: boolean;
  onSelect: (key: string) => void;
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 767px)").matches
      : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

export function ModelSelector({
  models,
  activeKey,
  defaultKey,
  offline = false,
  loading = false,
  onSelect,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const rootRef = useRef<HTMLDivElement>(null);
  const active =
    models.find((model) => model.key === (activeKey ?? defaultKey)) ??
    models[0];
  const empty = models.length === 0;
  const isOffline = empty && offline;
  const isConnecting = empty && !offline && loading;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open, isMobile]);

  useEffect(() => {
    if (!open || isMobile) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current && !rootRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, isMobile]);

  const label = empty
    ? isOffline
      ? "engine offline"
      : isConnecting
        ? "connecting"
        : "no engines"
    : active?.displayName ?? "Model";

  const listContent = empty ? (
    <div className="dive-model-empty-state">
      <span className={`dive-model-empty-glyph ${isOffline ? "is-offline" : ""}`}>
        <Icon name={isOffline ? "refresh" : "spark"} size={16} />
      </span>
      <p className="dive-model-empty-title">
        {isOffline
          ? "No engines reachable"
          : isConnecting
            ? "Reaching the archive"
            : "No engines configured"}
      </p>
      <p className="dive-model-empty-sub">
        {isOffline
          ? "The backend is offline or still booting. Real engines appear here the moment it answers — no stand-ins."
          : isConnecting
            ? "Waiting for the backend to answer with its live model list."
            : "The backend answered but exposed no chat models. Check provider configuration."}
      </p>
    </div>
  ) : (
    models.map((model) => {
      const selected = model.key === (activeKey ?? defaultKey);
      const isDefault = model.key === defaultKey;
      return (
        <button
          key={model.key}
          role="option"
          aria-selected={selected}
          className={`dive-model-option ${selected ? "is-selected" : ""}`}
          onClick={() => {
            onSelect(model.key);
            setOpen(false);
          }}
        >
          <span className="opt-dot" />
          <span className="opt-body">
            <span className="opt-name">
              {model.displayName}
              {isDefault && <span className="opt-default">default</span>}
            </span>
            <span className="opt-meta">
              {model.provider} · {model.maxTokens.toLocaleString()} tok
            </span>
          </span>
          {selected && <Icon name="check" size={13} className="opt-check" />}
        </button>
      );
    })
  );

  return (
    <div className="dive-model-wrap" ref={rootRef}>
      <button
        className={`dive-model ${open ? "is-open" : ""}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Choose model"
        title="Reasoning engine"
      >
        <span
          className="dot"
          style={
            isOffline
              ? {
                background: "var(--flare)",
                boxShadow: "0 0 8px var(--flare-glow)",
                animation: "none",
              }
              : isConnecting
                ? { background: "var(--stone)", boxShadow: "none" }
                : undefined
          }
        />
        <span className={`dive-model-name ${isOffline ? "text-flare" : ""}`}>
          {label}
        </span>
        <Icon name="chevron" size={12} className="dive-model-chev" />
      </button>
      {open && !isMobile && (
        <div className="dive-model-menu fx-rise" role="listbox" aria-label="Available models">
          <p className="dive-model-menu-head">reasoning engine</p>
          <div className="dive-model-menu-list">{listContent}</div>
        </div>
      )}
      {open &&
        isMobile &&
        createPortal(
          <>
            <div
              className="dive-sheet-veil"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <div className="dive-sheet" role="listbox" aria-label="Available models">
              <span className="dive-sheet-handle" aria-hidden="true" />
              <p className="dive-model-menu-head">reasoning engine</p>
              <div className="dive-model-menu-list">{listContent}</div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}