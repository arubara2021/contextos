import { useEffect, useState } from "react";
import { Icon, type IconName } from "../shared/Icon";
import { api } from "../../api";
import { useSettings } from "../../hooks/useSettings";
import { formatBytes, formatDuration } from "../../utils/format";
import type { ExportStatsResponse, HealthResponse } from "../../types";

interface ToolRow {
  name: string;
  detail: string;
  status: "live" | "checking" | "down";
  icon: IconName;
  color: string;
}

export function ConnectedTools() {
  const { settings } = useSettings();
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [stats, setStats] = useState<ExportStatsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([api.health.check(), api.export.stats()]).then(
      ([healthResult, statsResult]) => {
        if (cancelled) return;
        if (healthResult.status === "fulfilled") setHealth(healthResult.value);
        if (statsResult.status === "fulfilled") setStats(statsResult.value);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultModel = settings?.models.available.find(
    (model) => model.key === settings.models.default
  );

  const tools: ToolRow[] = [
    {
      name: "Amazon Bedrock",
      detail: defaultModel ? `${defaultModel.displayName} · ${defaultModel.provider}` : "reading model registry…",
      status: settings ? "live" : "checking",
      icon: "cortex",
      color: "#FF8A3D",
    },
    {
      name: "CockroachDB",
      detail: health ? `${health.environment} · up ${formatDuration(health.uptime)}` : "feeling for a pulse…",
      status: health ? (health.status === "unhealthy" ? "down" : "live") : "checking",
      icon: "database",
      color: "#8FD8D2",
    },
    {
      name: "S3 Object Store",
      detail: stats ? `${stats.storage.objectCount} objects · ${formatBytes(stats.storage.totalSizeBytes)}` : "weighing the vault…",
      status: stats ? "live" : "checking",
      icon: "archive",
      color: "#9DB98A",
    },
  ];

  const liveCount = tools.filter((tool) => tool.status === "live").length;

  return (
    <section className="panel settings-panel">
      <span className="panel-accent" />
      <div className="panel-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="panel-medallion">
            <Icon name="layers" size={16} />
          </span>
          <div className="panel-head-text">
            <span className="panel-title">Connected tools</span>
            <span className="panel-kicker">the services the memory layer leans on</span>
          </div>
        </div>
      </div>

      <div className="panel-pad grid gap-6 lg:grid-cols-[1fr_200px]">
        <div className="flex flex-col">
          {tools.map((tool) => (
            <div key={tool.name} className="tool-row" style={{ ["--spine" as string]: tool.color }}>
              <span className="tool-ic">
                <Icon name={tool.icon} size={16} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] text-bone">{tool.name}</p>
                <p className="t-mono truncate text-[9.5px] uppercase tracking-[0.14em] text-stone/60">
                  {tool.detail}
                </p>
              </div>
              <span className="flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${tool.status === "checking" ? "animate-pulse" : tool.status === "down" ? "fx-flicker" : ""}`}
                  style={{
                    background: tool.status === "live" ? "var(--moss)" : tool.status === "down" ? "var(--flare)" : "var(--stone)",
                    boxShadow: tool.status === "live" ? "0 0 8px rgba(157,185,138,0.6)" : "none",
                  }}
                />
                <span className="t-mono text-[9px] uppercase tracking-[0.18em] text-stone">
                  {tool.status}
                </span>
              </span>
            </div>
          ))}
        </div>

        <aside className="side-fact">
          <span className="side-fact-label">Systems live</span>
          <span className="side-fact-value">
            {liveCount}
            <span className="text-stone/50">/{tools.length}</span>
          </span>
          <span className="side-fact-note">
            Bedrock reasons, CockroachDB remembers, S3 holds the raw archive.
          </span>
        </aside>
      </div>
    </section>
  );
}