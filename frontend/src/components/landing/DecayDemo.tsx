import { useEffect, useId, useMemo, useRef, useState } from "react";
import { strengthColor } from "../../utils/color";
import { strengthCategory, STRENGTH_CATEGORIES, CONCEPT_TYPES } from "../../constants";
import type { ConceptType } from "../../types";

interface Memory {
  label: string;
  sub: string;
  type: ConceptType;
  rate: number;
  strength: number;
}

const INITIAL: Memory[] = [
  { label: "Group Relative Policy Optimization", sub: "fact · used today", type: "fact", rate: 0.1, strength: 0.94 },
  { label: "Switched the cache to a partitioned LRU", sub: "decision · two days idle", type: "decision", rate: 0.2, strength: 0.58 },
  { label: "The repeated read on the orders endpoint", sub: "problem · six days idle", type: "problem", rate: 0.34, strength: 0.3 },
  { label: "That onboarding call from March", sub: "event · three weeks idle", type: "event", rate: 0.5, strength: 0.08 },
];

const W = 560;
const H = 300;
const PL = 30;
const PR = 16;
const PT = 16;
const PB = 30;
const IW = W - PL - PR;
const IH = H - PT - PB;

const xAt = (day: number) => PL + (day / 30) * IW;
const yAt = (s: number) => PT + (1 - Math.max(0, Math.min(1, s))) * IH;

function dayOf(strength: number, rate: number): number {
  const s = Math.max(0.02, Math.min(0.96, strength));
  const d = Math.log(s / 0.96) / Math.log(1 - rate);
  return Math.max(0, Math.min(30, Number.isFinite(d) ? d : 30));
}

function buildCurve(rate: number): { line: string; area: string } {
  const pts: string[] = [];
  for (let x = 0; x <= 30; x += 1) {
    const s = 0.96 * Math.pow(1 - rate, x);
    pts.push(`${x === 0 ? "M" : "L"}${xAt(x).toFixed(1)} ${yAt(s).toFixed(1)}`);
  }
  const line = pts.join(" ");
  const area = `${line} L${xAt(30).toFixed(1)} ${yAt(0).toFixed(1)} L${xAt(0).toFixed(1)} ${yAt(0).toFixed(1)} Z`;
  return { line, area };
}

export function DecayDemo() {
  const gradId = useId().replace(/[^a-zA-Z0-9]/g, "g");
  const [rows, setRows] = useState<Memory[]>(INITIAL);
  const [active, setActive] = useState(0);
  const [burst, setBurst] = useState(false);
  const hoverRef = useRef<Record<number, boolean>>({});
  const touchRef = useRef(0);
  const activeRef = useRef(0);
  const burstTimer = useRef<number | null>(null);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRows((prev) =>
        prev.map((row, i) => {
          if (hoverRef.current[i]) {
            return { ...row, strength: Math.min(1, row.strength + (1 - row.strength) * 0.12) };
          }
          return { ...row, strength: Math.max(0.04, row.strength * (1 - row.rate * 0.006)) };
        })
      );
    }, 70);
    return () => window.clearInterval(id);
  }, []);

  const fireBurst = () => {
    setBurst(true);
    if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
    burstTimer.current = window.setTimeout(() => setBurst(false), 820);
  };

  useEffect(() => {
    return () => {
      if (burstTimer.current !== null) window.clearTimeout(burstTimer.current);
    };
  }, []);

  const useMemory = (i: number, byUser: boolean) => {
    if (byUser) touchRef.current = Date.now();
    setActive(i);
    setRows((prev) =>
      prev.map((row, idx) =>
        idx === i ? { ...row, strength: Math.max(row.strength, 0.94) } : row
      )
    );
    fireBurst();
  };

  useEffect(() => {
    const id = window.setInterval(() => {
      if (Date.now() - touchRef.current < 6000) return;
      useMemory((activeRef.current + 1) % INITIAL.length, false);
    }, 4200);
    return () => window.clearInterval(id);
  }, []);

  const mem = rows[active];
  const heat = strengthColor(mem.strength);
  const cat = strengthCategory(mem.strength);
  const catMeta = STRENGTH_CATEGORIES[cat];
  const typeMeta = CONCEPT_TYPES[mem.type];
  const pct = Math.round(mem.strength * 100);
  const day = dayOf(mem.strength, mem.rate);
  const curve = useMemo(() => buildCurve(mem.rate), [mem.rate]);
  const px = xAt(day);
  const py = yAt(mem.strength);
  const C = 2 * Math.PI * 44;

  const reignite = () => {
    touchRef.current = Date.now();
    setRows((prev) =>
      prev.map((row, idx) => (idx === active ? { ...row, strength: 0.96 } : row))
    );
    fireBurst();
  };

  return (
    <div className="theatre">
      <div className="theatre-rail" role="tablist" aria-label="Memories">
        {rows.map((row, i) => {
          const rowPct = Math.round(row.strength * 100);
          const rowHeat = strengthColor(row.strength);
          return (
            <button
              key={row.label}
              role="tab"
              aria-selected={i === active}
              className={`theatre-row ${i === active ? "is-active" : ""}`}
              onMouseEnter={() => {
                hoverRef.current[i] = true;
                setActive(i);
              }}
              onMouseLeave={() => {
                hoverRef.current[i] = false;
              }}
              onFocus={() => {
                hoverRef.current[i] = true;
                setActive(i);
              }}
              onBlur={() => {
                hoverRef.current[i] = false;
              }}
              onClick={() => useMemory(i, true)}
            >
              <span
                className="theatre-dot"
                style={{ background: CONCEPT_TYPES[row.type].color, boxShadow: `0 0 8px ${CONCEPT_TYPES[row.type].color}` }}
              />
              <span className="theatre-row-meta">
                <span className="theatre-row-label">{row.label}</span>
                <span className="theatre-row-sub">{row.sub}</span>
                <span className="theatre-bar">
                  <span
                    className="theatre-bar-fill"
                    style={{ width: `${rowPct}%`, background: rowHeat, boxShadow: `0 0 8px ${rowHeat}` }}
                  />
                </span>
              </span>
              <span className="theatre-row-pct" style={{ color: rowHeat }}>
                {rowPct}%
              </span>
            </button>
          );
        })}
      </div>

      <div className="theatre-stage">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`${gradId}area`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={heat} stopOpacity="0.3" />
              <stop offset="1" stopColor={heat} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[7.5, 15, 22.5].map((v) => (
            <line key={v} x1={xAt(v)} x2={xAt(v)} y1={PT} y2={H - PB} className="th-vline" />
          ))}
          {[0.7, 0.4, 0.1].map((v) => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={yAt(v)} y2={yAt(v)} className="th-line" />
              <text x={W - PR} y={yAt(v) - 5} textAnchor="end" className="th-text">
                {STRENGTH_CATEGORIES[strengthCategory(v + 0.001)].label.toLowerCase()}
              </text>
            </g>
          ))}
          <path d={curve.area} fill={`url(#${gradId}area)`} />
          <path d={curve.line} className="th-curve" style={{ stroke: heat }} />
          <line x1={px} x2={px} y1={py} y2={yAt(0)} className="th-drop" style={{ stroke: heat }} />
          {burst && <circle cx={px} cy={py} r={10} className="th-burst" style={{ stroke: heat }} />}
          <circle cx={px} cy={py} r={11} className="th-point-glow" style={{ fill: heat }} />
          <circle cx={px} cy={py} r={4.5} className="th-point" style={{ fill: heat }} />
          <text x={PL} y={H - 8} className="th-text">now</text>
          <text x={xAt(15)} y={H - 8} textAnchor="middle" className="th-text">15d</text>
          <text x={W - PR} y={H - 8} textAnchor="end" className="th-text">30d</text>
        </svg>
        <span className="theatre-stage-tag">
          live decay curve · {(mem.rate * 100).toFixed(0)}%/day
        </span>
        <span className="theatre-stage-days">day {Math.round(day)} / 30</span>
      </div>

      <div className="theatre-dial">
        <div className="dial-wrap">
          <svg viewBox="0 0 120 120" className="dial-svg" aria-hidden="true">
            <circle cx={60} cy={60} r={44} className="dial-track" />
            <circle
              cx={60}
              cy={60}
              r={44}
              className={`dial-fill ${burst ? "fx-ignite" : ""}`}
              style={{
                stroke: heat,
                strokeDasharray: C,
                strokeDashoffset: C * (1 - mem.strength),
              }}
            />
          </svg>
          <div className="dial-center">
            <span className="dial-pct" style={{ color: heat }}>{pct}%</span>
            <span className="dial-cat" style={{ color: catMeta.color }}>{catMeta.label}</span>
          </div>
        </div>
        <span
          className="theatre-type"
          style={{ color: typeMeta.color, borderColor: typeMeta.color }}
        >
          {typeMeta.label}
        </span>
        <button className="theatre-reignite" onClick={reignite}>
          Reignite
        </button>
        <p className="theatre-note">
          Hover or tap a memory to use it. Click reignite and watch the point fly back to white-gold.
        </p>
      </div>
    </div>
  );
}