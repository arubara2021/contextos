import { useId } from "react";
import type { DecayCurvePoint, StrengthCategory } from "../../types";

interface DecayCurveChartProps {
  points: DecayCurvePoint[];
  strength: number;
  category: StrengthCategory;
}

export function DecayCurveChart({ points, strength, category }: DecayCurveChartProps) {
  const gradientId = useId();

  if (points.length < 2) {
    return <div className="decay-chart" />;
  }

  const maxDay = points[points.length - 1].day || 1;
  const px = (day: number) => 10 + (day / maxDay) * 300;
  const py = (value: number) => 86 - value * 76;
  const line = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${px(point.day).toFixed(1)} ${py(point.strength).toFixed(1)}`
    )
    .join(" ");
  const area = `${line} L${px(maxDay).toFixed(1)} 86 L10 86 Z`;
  const projected = points[points.length - 1].strength;
  const stroke =
    category === "critical" ? "#FF5C49" : category === "forgotten" ? "#57504A" : "#FF8A3D";

  return (
    <svg className="decay-chart" viewBox="0 0 320 104" role="img" aria-label="Memory decay curve">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line className="baseline" x1="10" y1="86" x2="310" y2="86" />
      <line className="threshold" x1="10" y1={py(0.1)} x2="310" y2={py(0.1)} />
      <path className="area" d={area} fill={`url(#${gradientId})`} />
      <path className="curve" d={line} style={{ stroke }} />
      <circle
        cx={px(0)}
        cy={py(strength)}
        r="3.2"
        fill={stroke}
        style={{ filter: `drop-shadow(0 0 5px ${stroke})` }}
      />
      <text
        x="10"
        y="100"
        fontSize="7.5"
        fill="#6B5F54"
        fontFamily="'Spline Sans Mono', monospace"
        letterSpacing="1"
      >
        NOW
      </text>
      <text
        x="310"
        y="100"
        fontSize="7.5"
        fill="#6B5F54"
        fontFamily="'Spline Sans Mono', monospace"
        letterSpacing="1"
        textAnchor="end"
      >
        +{maxDay}D
      </text>
      <text
        x="310"
        y={py(projected) - 6}
        fontSize="8"
        fill={stroke}
        fontFamily="'Spline Sans Mono', monospace"
        textAnchor="end"
      >
        {Math.round(projected * 100)}%
      </text>
    </svg>
  );
}