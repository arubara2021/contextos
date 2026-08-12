import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

interface EmptyStateProps {
  icon?: IconName;
  title: string;
  sub?: string;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon = "spark", title, sub, action, compact = false }: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? "!py-10" : ""}`}>
      <span className="empty-glyph">
        <Icon name={icon} size={compact ? 20 : 26} />
      </span>
      <p className="empty-title">{title}</p>
      {sub && <p className="empty-sub">{sub}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}