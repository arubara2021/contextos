import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { api } from "../../api";
import { formatBytes, formatNumber } from "../../utils/format";
import type { ExportStatsResponse } from "../../types";

export function StorageSettings() {
  const [stats, setStats] = useState<ExportStatsResponse | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [backupMessage, setBackupMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.export
      .stats()
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const downloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = async (kind: "memories" | "conversations") => {
    if (working) return;
    setWorking(kind);
    try {
      const data = kind === "memories" ? await api.export.memories() : await api.export.conversations();
      downloadJson(data, `contextos-${kind}-${Date.now()}.json`);
    } finally {
      setWorking(null);
    }
  };

  const handleBackup = async () => {
    if (working) return;
    setWorking("backup");
    try {
      const result = await api.export.backup();
      setBackupMessage(
        `${result.message} — ${Object.entries(result.summary)
          .map(([key, value]) => `${key}: ${value}`)
          .join(" · ")}`
      );
    } finally {
      setWorking(null);
    }
  };

  const tiles = [
    { label: "memories", value: stats ? formatNumber(stats.exportable.buckets) : "···", tone: "hot" },
    { label: "documents", value: stats ? formatNumber(stats.exportable.documents) : "···", tone: "" },
    { label: "sessions", value: stats ? formatNumber(stats.exportable.sessions) : "···", tone: "" },
    { label: "embeddings", value: stats ? formatNumber(stats.exportable.embeddings) : "···", tone: "cold" },
  ];

  return (
    <section className="panel settings-panel">
      <span className="panel-accent" />
      <div className="panel-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="panel-medallion">
            <Icon name="database" size={16} />
          </span>
          <div className="panel-head-text">
            <span className="panel-title">Storage &amp; export</span>
            <span className="panel-kicker">weigh the vault, take it with you</span>
          </div>
        </div>
        {stats && (
          <span className="t-mono text-[9px] uppercase tracking-[0.18em] text-stone">
            {stats.storage.objectCount} objects
          </span>
        )}
      </div>

      <div className="panel-pad grid gap-6 lg:grid-cols-[1fr_200px]">
        <div>
          <div className="grid grid-cols-2 gap-3">
            {tiles.map((tile) => (
              <div key={tile.label} className={`stat-tile ${tile.tone}`}>
                <p className="stat-tile-label">{tile.label}</p>
                <p className="stat-tile-value !text-2xl">{tile.value}</p>
              </div>
            ))}
          </div>

          {stats && (
            <p className="t-mono mt-4 text-[9px] uppercase tracking-[0.18em] text-stone/60">
              {formatNumber(stats.exportable.relationships)} relationships ·{" "}
              {formatNumber(stats.exportable.messages)} messages
            </p>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <button className="btn btn-ghost btn-sm" onClick={() => void handleExport("memories")} disabled={working !== null}>
              <Icon name="download" size={14} />
              {working === "memories" ? "Exporting…" : "Export memories"}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void handleExport("conversations")} disabled={working !== null}>
              <Icon name="download" size={14} />
              {working === "conversations" ? "Exporting…" : "Export conversations"}
            </button>
            <button className="btn btn-mineral btn-sm" onClick={() => void handleBackup()} disabled={working !== null}>
              <Icon name="database" size={14} />
              {working === "backup" ? "Sealing…" : "Full backup"}
            </button>
          </div>

          {backupMessage && (
            <p className="fx-rise mt-4 text-[13px] font-light leading-relaxed text-moss">
              {backupMessage}
            </p>
          )}
        </div>

        <aside className="side-fact">
          <span className="side-fact-label">Object storage</span>
          <span className="side-fact-value text-mineral !text-[22px]">
            {stats ? formatBytes(stats.storage.totalSizeBytes) : "—"}
          </span>
          <span className="side-fact-note">
            Raw text and sealed backups live in S3; the live graph lives in CockroachDB.
          </span>
        </aside>
      </div>
    </section>
  );
}