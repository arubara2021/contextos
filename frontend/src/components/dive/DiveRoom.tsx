import { useMemo, type CSSProperties } from "react";

export function DiveRoom() {
  const dust = useMemo(
    () =>
      Array.from({ length: 10 }, () => ({
        left: `${Math.random() * 100}%`,
        top: `${30 + Math.random() * 70}%`,
        duration: `${10 + Math.random() * 14}s`,
        delay: `${-Math.random() * 12}s`,
        driftX: `${Math.round(Math.random() * 70 - 35)}px`,
        scale: 0.5 + Math.random() * 0.8,
      })),
    []
  );

  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
      aria-hidden="true"
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1200 800"
        preserveAspectRatio="xMidYMid slice"
      >
        <path
          d="M-50 620 C 250 520, 420 700, 700 580 S 1100 480, 1260 560"
          stroke="rgba(255, 138, 61, 0.10)"
          strokeWidth="1.4"
          fill="none"
        />
        <path
          className="fx-dash"
          d="M-40 200 C 260 300, 520 140, 820 240 S 1150 320, 1250 240"
          stroke="rgba(143, 216, 210, 0.10)"
          strokeWidth="1.2"
          fill="none"
          strokeDasharray="6 10"
        />
        <path
          d="M180 -40 C 240 220, 120 420, 260 700"
          stroke="rgba(236, 229, 218, 0.05)"
          strokeWidth="1.2"
          fill="none"
        />
        <path
          className="fx-dash"
          d="M-30 430 C 300 380, 620 480, 900 400 S 1180 350, 1240 390"
          stroke="rgba(255, 138, 61, 0.06)"
          strokeWidth="1.1"
          fill="none"
          strokeDasharray="4 12"
        />
        <circle className="fx-breathe" cx="700" cy="580" r="3" fill="rgba(255, 177, 92, 0.5)" />
        <circle
          className="fx-breathe"
          cx="820"
          cy="240"
          r="2.4"
          fill="rgba(143, 216, 210, 0.45)"
          style={{ animationDelay: "1.2s" }}
        />
        <circle
          className="fx-breathe"
          cx="260"
          cy="700"
          r="2"
          fill="rgba(236, 229, 218, 0.3)"
          style={{ animationDelay: "2.1s" }}
        />
        <circle
          className="fx-breathe"
          cx="900"
          cy="400"
          r="2.2"
          fill="rgba(255, 138, 61, 0.4)"
          style={{ animationDelay: "3s" }}
        />
      </svg>

      {dust.map((spec, i) => (
        <span
          key={i}
          className="dust"
          style={
            {
              left: spec.left,
              top: spec.top,
              transform: `scale(${spec.scale})`,
              "--drift-dur": spec.duration,
              "--drift-delay": spec.delay,
              "--drift-x": spec.driftX,
            } as CSSProperties
          }
        />
      ))}

      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 40%, transparent 55%, rgba(8, 6, 5, 0.5) 100%)",
        }}
      />
    </div>
  );
}