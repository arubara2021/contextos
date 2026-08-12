const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export function toTime(value: string | Date): number {
  return typeof value === "string" ? new Date(value).getTime() : value.getTime();
}

export function daysSince(value: string | Date): number {
  return Math.max(0, (Date.now() - toTime(value)) / DAY_MS);
}

export function relativeTime(value: string | Date): string {
  const diff = Date.now() - toTime(value);
  if (diff < 45_000) return "just now";
  if (diff < HOUR_MS) return `${Math.max(1, Math.round(diff / MINUTE_MS))}m ago`;
  if (diff < DAY_MS) return `${Math.round(diff / HOUR_MS)}h ago`;
  if (diff < 7 * DAY_MS) return `${Math.round(diff / DAY_MS)}d ago`;
  if (diff < 35 * DAY_MS) return `${Math.round(diff / (7 * DAY_MS))}w ago`;
  return formatDay(value);
}

export function formatClock(value: string | Date): string {
  return new Date(toTime(value)).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(value: string | Date): string {
  return new Date(toTime(value)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatFull(value: string | Date): string {
  return new Date(toTime(value)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDayTime(value: string | Date): string {
  return `${formatDay(value)} · ${formatClock(value)}`;
}

export function isToday(value: string | Date): boolean {
  const d = new Date(toTime(value));
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function addDays(days: number, from: Date = new Date()): Date {
  const result = new Date(from);
  result.setDate(result.getDate() + days);
  return result;
}

export function formatFutureDay(days: number): string {
  return formatDay(addDays(days));
}