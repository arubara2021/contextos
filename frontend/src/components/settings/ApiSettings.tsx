import { useCallback, useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { api } from "../../api";
import { useSettings } from "../../hooks/useSettings";
import { formatDuration, formatMs } from "../../utils/format";
import type { HealthResponse } from "../../types";

export function ApiSettings() {
  const { settings } = useSettings();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);

  const ping = useCallback(async () => {
    setChecking(true);
    const start = performance.now();
    try {
      const result = await api.health.check();
      setHealth(result);
      setLatency(Math.round(performance.now() - start));
    } catch {
      setHealth(null);
      setLatency(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void ping();
  }, [ping]);

  const status = health
    ? health.status === "healthy"
      ? "live"
      : "degraded"
    : checking
      ? "checking"
      : "unreachable";

  const statusColor =
    status === "live" ? "var(--moss)" : status === "degraded" ? "var(--ember)" : "var(--flare)";

  const defaultModel = settings?.models.available.find(
    (model) => model.key === settings.models.default
  );

  const rows = [
    { label: "endpoint", value: "localhost:3001/api" },
    { label: "environment", value: health?.environment ?? "—" },
    { label: "version", value: health?.version ?? "—" },
    { label: "uptime", value: health ? formatDuration(health.uptime) : "—" },
    { label: "default model", value: defaultModel?.displayName ?? "—" },
  ];

  return (
    <section className="panel settings-panel">
      <span className="panel-accent" />
      <div className="panel-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="panel-medallion">
            <Icon name="graph" size={16} />
          </span>
          <div className="panel-head-text">
            <span className="panel-title">Backend link</span>
            <span className="panel-kicker">the pulse between interface and memory</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => void ping()} disabled={checking}>
          <Icon name="refresh" size={13} className={checking ? "fx-spin-slow" : ""} />
          Ping
        </button>
      </div>

      <div className="panel-pad grid gap-6 lg:grid-cols-[1fr_200px]">
        <div>
          <div className="mb-5 flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5">
              {status === "live" && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60" style={{ background: statusColor }} />
              )}
              <span
                className={`relative inline-flex h-2.5 w-2.5 rounded-full ${status === "checking" ? "animate-pulse" : status === "unreachable" ? "fx-flicker" : ""}`}
                style={{ background: statusColor }}
              />
            </span>
            <span className="font-display text-xl font-medium capitalize text-bone">{status}</span>
            <span className="t-mono text-[9px] uppercase tracking-[0.2em] text-stone/60">
              contextos backend
            </span>
          </div>

          <div className="flex flex-col gap-2.5">
            {rows.map((row) => (
              <div key={row.label} className="kv-row">
                <span className="kv-key">{row.label}</span>
                <span className="kv-val">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        <aside className="side-fact">
          <span className="side-fact-label">Round trip</span>
          <span
            className="side-fact-value"
            style={{ color: latency === null ? "var(--stone)" : latency < 120 ? "var(--moss)" : latency < 400 ? "var(--ember-hi)" : "var(--flare)" }}
          >
            {latency === null ? "—" : formatMs(latency)}
          </span>
          <span className="side-fact-note">
            Measured on the last ping to the health endpoint.
          </span>
        </aside>
      </div>
    </section>
  );
}