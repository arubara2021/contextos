import { useId, useMemo, type CSSProperties, type ReactNode } from "react";
import { Logo } from "../shared/Logo";

interface AuthBrandSceneProps {
  kicker: string;
  title: ReactNode;
  subtitle: string;
  chips: string[];
}

const NODES: Array<[number, number, number, string]> = [
  [92, 148, 5, "rgb(255 138 61 / 0.72)"],
  [218, 96, 4, "rgb(143 216 210 / 0.62)"],
  [351, 176, 6, "rgb(255 177 92 / 0.68)"],
  [520, 96, 4, "rgb(255 92 73 / 0.52)"],
  [618, 232, 5, "rgb(143 216 210 / 0.48)"],
  [128, 360, 4, "rgb(236 229 218 / 0.34)"],
  [292, 332, 7, "rgb(255 138 61 / 0.66)"],
  [478, 368, 4, "rgb(157 185 138 / 0.5)"],
  [612, 486, 5, "rgb(255 177 92 / 0.54)"],
  [188, 566, 5, "rgb(143 216 210 / 0.54)"],
  [365, 590, 4, "rgb(255 138 61 / 0.56)"],
  [540, 650, 6, "rgb(143 216 210 / 0.44)"],
];

const EDGES: Array<[number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [2, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [8, 11],
];

interface DustSpec {
  left: string;
  top: string;
  duration: string;
  delay: string;
  driftX: string;
  scale: number;
}

export function AuthBrandScene({
  kicker,
  title,
  subtitle,
  chips,
}: AuthBrandSceneProps) {
  const gradientId = useId();

  const dust = useMemo<DustSpec[]>(
    () =>
      Array.from({ length: 26 }, () => ({
        left: `${Math.random() * 100}%`,
        top: `${14 + Math.random() * 84}%`,
        duration: `${9 + Math.random() * 18}s`,
        delay: `${-Math.random() * 16}s`,
        driftX: `${Math.round(Math.random() * 100 - 50)}px`,
        scale: 0.5 + Math.random() * 1.2,
      })),
    []
  );

  return (
    <section className="sticky top-0 flex h-[100dvh] flex-col justify-between overflow-hidden border-r border-line p-10 lg:p-14">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(620px 420px at 18% 18%, rgb(255 138 61 / 0.14), transparent 62%), radial-gradient(520px 380px at 84% 76%, rgb(143 216 210 / 0.09), transparent 58%), radial-gradient(700px 520px at 52% 118%, rgb(255 138 61 / 0.1), transparent 60%)",
        }}
      />

      <svg
        className="pointer-events-none absolute inset-0 h-full w-full opacity-35"
        viewBox="0 0 760 900"
        fill="none"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="0"
            y1="0"
            x2="760"
            y2="900"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="rgb(255 138 61 / 0.34)" />
            <stop offset="1" stopColor="rgb(143 216 210 / 0.18)" />
          </linearGradient>
        </defs>

        {EDGES.map(([from, to], index) => (
          <line
            key={`${from}-${to}-${index}`}
            x1={NODES[from][0]}
            y1={NODES[from][1]}
            x2={NODES[to][0]}
            y2={NODES[to][1]}
            stroke={`url(#${gradientId})`}
            strokeWidth="1"
            strokeDasharray={index % 3 === 0 ? "3 8" : index % 3 === 1 ? "7 8" : "1 7"}
            opacity="0.55"
          />
        ))}

        {NODES.map(([x, y, radius, fill], index) => (
          <circle
            key={`${x}-${y}-${index}`}
            cx={x}
            cy={y}
            r={radius}
            fill={fill}
            className="fx-breathe"
            style={{
              animationDelay: `${index * 0.34}s`,
              filter: `drop-shadow(0 0 10px ${fill})`,
            }}
          />
        ))}
      </svg>

      {dust.map((spec, index) => (
        <span
          key={index}
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

      <div className="relative flex items-center gap-4">
        <Logo size={42} />
        <span className="font-display text-2xl font-medium tracking-wide text-bone">
          Context
          <span className="align-super font-mono text-[11px] tracking-[0.2em] text-ember">
            OS
          </span>
        </span>
      </div>

      <div className="relative max-w-xl">
        <p className="kicker">{kicker}</p>

        <h1 className="font-display text-[clamp(42px,4.8vw,72px)] font-medium leading-[1.02] tracking-[-0.02em] text-bone">
          {title}
        </h1>

        <p className="mt-6 max-w-lg text-[15px] font-light leading-relaxed text-stone">
          {subtitle}
        </p>

        <div className="mt-8 flex flex-wrap gap-2.5">
          {chips.map((chip, index) => (
            <span
              key={chip}
              className="fx-rise inline-flex items-center gap-2 rounded-full border border-line-strong bg-coal/60 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.22em] text-stone backdrop-blur-sm"
              style={{ "--rise-delay": `${0.08 + index * 0.06}s` } as CSSProperties}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-ember shadow-ember" />
              {chip}
            </span>
          ))}
        </div>
      </div>

      <div className="relative flex items-center gap-4 font-mono text-[9px] uppercase tracking-[0.24em] text-stone/70">
        <span>Extract once</span>
        <span className="h-1 w-1 rounded-full bg-ember shadow-ember" />
        <span>Retrieve forever</span>
        <span className="h-1 w-1 rounded-full bg-ember shadow-ember" />
        <span>Decay honestly</span>
      </div>
    </section>
  );
}