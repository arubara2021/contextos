export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(clamp(ratio, 0, 1) * 100).toFixed(digits)}%`;
}

export function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round((value / 1_000_000) * 10) / 10}M`;
  if (abs >= 1_000) return `${Math.round((value / 1_000) * 10) / 10}K`;
  return String(Math.round(value));
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${Math.round((ms / 1000) * 100) / 100}s`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  return hrs > 0 ? `${days}d ${hrs}h` : `${days}d`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb * 100) / 100} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${Math.round(mb * 100) / 100} MB`;
  return `${Math.round((mb / 1024) * 100) / 100} GB`;
}

export function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.substring(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.substring(0, lastSpace) : cut).trimEnd() + "…";
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].substring(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function sessionTitleFromMessage(message: string): string {
  return truncate(message, 50);
}

export function formatScore(score: number): string {
  return clamp(score, 0, 1).toFixed(2);
}