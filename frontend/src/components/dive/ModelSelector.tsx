import { useEffect, useState } from "react";
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

export function ModelSelector({
  models,
  activeKey,
  defaultKey,
  offline = false,
  loading = false,
  onSelect,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
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

  const label = empty
    ? isOffline
      ? "engine offline"
      : isConnecting
        ? "connecting"
        : "no engines"
    : active?.displayName ?? "Model";

  return (
    <div className="relative">
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
      {open && (
        <>
          <div
            className="dive-model-veil"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="dive-model-menu fx-rise"
            role="listbox"
            aria-label="Available models"
          >
            <span className="dive-model-sheet-handle" aria-hidden="true" />
            <p className="dive-model-menu-head">reasoning engine</p>
            <div className="dive-model-menu-list">
              {empty ? (
                <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                  <span
                    className={`grid h-11 w-11 place-items-center rounded-2xl border ${isOffline
                        ? "border-flare/40 bg-flare/10 text-flare"
                        : "border-line-strong bg-soot text-stone"
                      }`}
                  >
                    <Icon name={isOffline ? "refresh" : "spark"} size={16} />
                  </span>
                  <p className="text-[13px] text-bone">
                    {isOffline
                      ? "No engines reachable"
                      : isConnecting
                        ? "Reaching the archive"
                        : "No engines configured"}
                  </p>
                  <p className="max-w-[220px] text-[11.5px] font-light leading-[1.6] text-stone">
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
                          {isDefault && (
                            <span className="opt-default">default</span>
                          )}
                        </span>
                        <span className="opt-meta">
                          {model.provider} · {model.maxTokens.toLocaleString()} tok
                        </span>
                      </span>
                      {selected && (
                        <Icon name="check" size={13} className="opt-check" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}