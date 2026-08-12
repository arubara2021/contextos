import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { useSettings } from "../../hooks/useSettings";
import { useStats } from "../../hooks/useStats";

interface EmberRangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  color: string;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}

function EmberRange({ label, value, min, max, step, color, format, onChange }: EmberRangeProps) {
  const pct = max > min ? (value - min) / (max - min) : 0;
  const clamped = Math.max(0, Math.min(1, pct));
  const shown = format ? format(value) : String(value);
  return (
    <div className="ember-range" style={{ ["--pct" as string]: clamped, ["--rng" as string]: color }}>
      <div className="ember-range-head">
        <span className="label">{label}</span>
        <span className="ember-range-value">{shown}</span>
      </div>
      <div className="ember-range-track-wrap">
        <span className="ember-range-bubble">{shown}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={label}
        />
      </div>
    </div>
  );
}

export function MemoryPreferences() {
  const { settings, saving, update } = useSettings();
  const { stats } = useStats();
  const [budget, setBudget] = useState(20);
  const [strongThreshold, setStrongThreshold] = useState(0.7);
  const [fadingThreshold, setFadingThreshold] = useState(0.4);
  const [semanticWeight, setSemanticWeight] = useState(0.45);
  const [strengthWeight, setStrengthWeight] = useState(0.3);
  const [recencyWeight, setRecencyWeight] = useState(0.25);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setBudget(settings.memory.maxContextMemories);
    setStrongThreshold(settings.decay.strongThreshold);
    setFadingThreshold(settings.decay.fadingThreshold);
    setSemanticWeight(settings.scorer.semanticWeight);
    setStrengthWeight(settings.scorer.strengthWeight);
    setRecencyWeight(settings.scorer.recencyWeight);
  }, [settings]);

  const handleSave = async () => {
    await update({
      maxContextMemories: budget,
      strongThreshold,
      fadingThreshold,
      semanticWeight,
      strengthWeight,
      recencyWeight,
    });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  const strong = stats?.strongCount ?? 0;
  const fading = stats?.fadingCount ?? 0;
  const critical = stats?.criticalCount ?? 0;
  const forgotten = stats?.forgottenCount ?? 0;
  const total = strong + fading + critical + forgotten;
  const health = total > 0 ? Math.round(((strong * 1 + fading * 0.6 + critical * 0.2) / total) * 100) : null;
  const healthColor = health === null ? "var(--stone)" : health >= 70 ? "var(--ember-hi)" : health >= 40 ? "#D99A5B" : "var(--flare)";
  const weightTotal = semanticWeight + strengthWeight + recencyWeight;

  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const filled = circumference * ((health ?? 0) / 100);

  return (
    <section className="panel settings-panel">
      <span className="panel-accent" />
      <div className="panel-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="panel-medallion">
            <Icon name="cortex" size={16} />
          </span>
          <div className="panel-head-text">
            <span className="panel-title">Memory &amp; decay</span>
            <span className="panel-kicker">how the archive forgets, and what it weighs</span>
          </div>
        </div>
        {saved && (
          <span className="fx-rise t-mono text-[10px] uppercase tracking-[0.2em] text-moss">
            <Icon name="check" size={12} className="mr-1 inline-block -translate-y-px" />
            applied
          </span>
        )}
      </div>

      <div className="panel-pad grid gap-6 lg:grid-cols-[1fr_224px]">
        <div>
          <div className="field">
            <label className="label" htmlFor="pref-budget">Forgetting budget</label>
            <input
              id="pref-budget"
              className="input"
              type="number"
              min={1}
              max={100}
              value={budget}
              onChange={(event) => setBudget(Number(event.target.value))}
            />
            <span className="field-hint">Memories injected into every query</span>
          </div>

          <p className="label mb-3 mt-5">Decay thresholds</p>
          <EmberRange label="Strong" value={strongThreshold} min={0} max={1} step={0.05} color="#FF8A3D" format={(v) => v.toFixed(2)} onChange={setStrongThreshold} />
          <EmberRange label="Fading" value={fadingThreshold} min={0} max={1} step={0.05} color="#C8551F" format={(v) => v.toFixed(2)} onChange={setFadingThreshold} />

          <p className="label mb-3 mt-6">Relevance scorer</p>
          <EmberRange label="Semantic match" value={semanticWeight} min={0} max={1} step={0.05} color="#8FD8D2" format={(v) => v.toFixed(2)} onChange={setSemanticWeight} />
          <EmberRange label="Memory strength" value={strengthWeight} min={0} max={1} step={0.05} color="#FF8A3D" format={(v) => v.toFixed(2)} onChange={setStrengthWeight} />
          <EmberRange label="Recency" value={recencyWeight} min={0} max={1} step={0.05} color="#A29384" format={(v) => v.toFixed(2)} onChange={setRecencyWeight} />

          <p className="field-hint mt-4">
            Weights normalize at query time — current sum {weightTotal.toFixed(2)}
          </p>

          <button className="btn btn-primary btn-sm mt-5" onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Applying…" : "Apply memory settings"}
          </button>
        </div>

        <aside className="side-fact items-center text-center">
          <span className="side-fact-label">Memory health</span>
          <div className="relative my-1 grid place-items-center">
            <svg width="72" height="72" viewBox="0 0 72 72" className="-rotate-90" aria-hidden="true">
              <circle cx="36" cy="36" r={radius} fill="none" stroke="rgba(236,229,218,0.1)" strokeWidth="5" />
              <circle
                cx="36"
                cy="36"
                r={radius}
                fill="none"
                stroke={healthColor}
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${filled} ${circumference - filled}`}
                style={{ transition: "stroke-dasharray 0.8s cubic-bezier(0.22, 1, 0.36, 1)", filter: `drop-shadow(0 0 5px ${healthColor})` }}
              />
            </svg>
            <span className="absolute font-display text-lg font-medium" style={{ color: healthColor }}>
              {health === null ? "—" : `${health}%`}
            </span>
          </div>
          <span className="side-fact-note">
            {total > 0
              ? `${strong} strong · ${fading} fading · ${critical} critical`
              : "Feed the archive to take a reading."}
          </span>
        </aside>
      </div>
    </section>
  );
}