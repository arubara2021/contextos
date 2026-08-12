interface ContextBudgetIndicatorProps {
  used: number;
  max: number;
  compact?: boolean;
}

export function ContextBudgetIndicator({
  used,
  max,
  compact = false,
}: ContextBudgetIndicatorProps) {
  const ratio = max > 0 ? Math.min(1, used / max) : 0;
  const radius = compact ? 15 : 21;
  const stroke = compact ? 3 : 4;
  const size = (radius + stroke) * 2 + 2;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * ratio;
  const hot = ratio >= 0.8;
  const color = hot ? "#FF5C49" : "#FF8A3D";

  return (
    <div
      className="flex items-center gap-3"
      title={`Forgetting budget: ${used} of ${max} memories`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(236, 229, 218, 0.1)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference - filled}`}
          style={{
            transition: "stroke-dasharray 0.8s cubic-bezier(0.22, 1, 0.36, 1)",
            filter: `drop-shadow(0 0 4px ${color})`,
          }}
        />
      </svg>

      {!compact && (
        <div>
          <p className={`t-mono text-[13px] ${hot ? "text-flare" : "text-bone"}`}>
            {used}
            <span className="text-stone/60">/{max}</span>
          </p>
          <p className="t-mono text-[8.5px] uppercase tracking-[0.2em] text-stone">
            forgetting budget
          </p>
        </div>
      )}
    </div>
  );
}