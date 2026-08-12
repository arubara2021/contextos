import { Icon } from "../shared/Icon";

interface NotificationBellProps {
  criticalCount: number;
  active?: boolean;
  onClick: () => void;
}

export function NotificationBell({ criticalCount, active = false, onClick }: NotificationBellProps) {
  const alert = criticalCount > 0;

  return (
    <button
      className={`hud-bell ${alert ? "alert" : ""} ${active ? "!border-line-strong !bg-soot !text-bone" : ""}`}
      onClick={onClick}
      aria-label="Notifications"
      title={alert ? `${criticalCount} memories need attention` : "Signals"}
    >
      {alert && <span className="hud-bell-ring" />}
      <Icon name="bell" size={18} />
      {alert && <span className="hud-bell-count">{criticalCount > 9 ? "9+" : criticalCount}</span>}
    </button>
  );
}