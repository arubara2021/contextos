import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";
import { useSettings } from "../../hooks/useSettings";

const PREF_KEYS = {
  flickerBell: "contextos.pref.flickerBell",
  forgettingHints: "contextos.pref.forgettingHints",
  autoOpenPanel: "contextos.pref.autoOpenPanel",
} as const;

type PrefKey = keyof typeof PREF_KEYS;

function readPref(key: PrefKey, fallback: boolean): boolean {
  const raw = localStorage.getItem(PREF_KEYS[key]);
  return raw === null ? fallback : raw === "1";
}

const INTERVAL_OPTIONS = [1, 6, 12, 24, 48, 72];

const TOGGLES: Array<{ key: PrefKey; title: string; hint: string }> = [
  { key: "flickerBell", title: "Flicker the bell", hint: "Pulse the signal bell while any memory sits in critical strength." },
  { key: "forgettingHints", title: "Forgetting hints in the cortex", hint: "Whisper cold-storage markers into the graph legend." },
  { key: "autoOpenPanel", title: "Surface signals on arrival", hint: "Open the signals panel the instant a new reminder lands." },
];

export function NotificationSettings() {
  const { settings, saving, update } = useSettings();
  const [intervalHours, setIntervalHours] = useState(24);
  const [saved, setSaved] = useState(false);
  const [prefs, setPrefs] = useState<Record<PrefKey, boolean>>({
    flickerBell: readPref("flickerBell", true),
    forgettingHints: readPref("forgettingHints", true),
    autoOpenPanel: readPref("autoOpenPanel", false),
  });

  useEffect(() => {
    if (settings) setIntervalHours(settings.reminders.checkIntervalHours);
  }, [settings]);

  const togglePref = (key: PrefKey) => {
    setPrefs((current) => {
      const next = { ...current, [key]: !current[key] };
      localStorage.setItem(PREF_KEYS[key], next[key] ? "1" : "0");
      return next;
    });
  };

  const handleSave = async () => {
    await update({ checkIntervalHours: intervalHours });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };

  return (
    <section className="panel settings-panel">
      <span className="panel-accent" />
      <div className="panel-head">
        <div className="flex min-w-0 items-center gap-3">
          <span className="panel-medallion">
            <Icon name="bell" size={16} />
          </span>
          <div className="panel-head-text">
            <span className="panel-title">Notifications</span>
            <span className="panel-kicker">when the archive taps you on the shoulder</span>
          </div>
        </div>
        {saved && (
          <span className="fx-rise t-mono text-[10px] uppercase tracking-[0.2em] text-moss">
            <Icon name="check" size={12} className="mr-1 inline-block -translate-y-px" />
            saved
          </span>
        )}
      </div>

      <div className="panel-pad grid gap-6 lg:grid-cols-[1fr_200px]">
        <div className="flex flex-col gap-3">
          {TOGGLES.map((toggle) => (
            <button
              key={toggle.key}
              className="toggle-row"
              onClick={() => togglePref(toggle.key)}
              aria-pressed={prefs[toggle.key]}
            >
              <span className={`toggle ${prefs[toggle.key] ? "on" : ""}`} />
              <span className="toggle-row-text">
                <span className="toggle-row-title">{toggle.title}</span>
                <span className="toggle-row-hint">{toggle.hint}</span>
              </span>
            </button>
          ))}

          <div className="mt-2 flex flex-wrap items-end gap-4 border-t border-line pt-4">
            <div className="field mb-0 w-44">
              <label className="label" htmlFor="pref-interval">Decay scan interval</label>
              <select
                id="pref-interval"
                className="select"
                value={intervalHours}
                onChange={(event) => setIntervalHours(Number(event.target.value))}
              >
                {INTERVAL_OPTIONS.map((hours) => (
                  <option key={hours} value={hours}>
                    every {hours}h
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Saving…" : "Save notifications"}
            </button>
          </div>
        </div>

        <aside className="side-fact">
          <span className="side-fact-label">Scan cadence</span>
          <span className="side-fact-value text-mineral">{intervalHours}h</span>
          <span className="side-fact-note">
            The decay engine sweeps on this clock and raises proactive reminders.
          </span>
        </aside>
      </div>
    </section>
  );
}