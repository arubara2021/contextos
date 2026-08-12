import { useEffect, useState } from "react";
import { Icon } from "../shared/Icon";

const STAGES = [
  { key: "understand", label: "understand", phrase: "reading your question" },
  { key: "sweep", label: "sweep", phrase: "sweeping vector · text · graph" },
  { key: "score", label: "score", phrase: "scoring candidates" },
  { key: "assemble", label: "assemble", phrase: "assembling context" },
];

const STAGE_MS = 1050;

export function MindReaching() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (stage >= STAGES.length - 1) return;
    const timer = window.setTimeout(() => setStage(stage + 1), STAGE_MS);
    return () => window.clearTimeout(timer);
  }, [stage]);

  return (
    <div className="mind-reaching" role="status" aria-live="polite">
      <div className="msg-avatar">
        <Icon name="spark" size={16} />
      </div>
      <div className="reach-body">
        <div className="reach-dots">
          <span className="reach-dot" />
          <span className="reach-dot" />
          <span className="reach-dot" />
        </div>

        <div className="flex flex-wrap items-center gap-y-2">
          {STAGES.map((s, i) => {
            const isDone = i < stage;
            const isActive = i === stage;
            return (
              <div key={s.key} className="flex items-center">
                {i > 0 && (
                  <span
                    className={`mx-2 h-px w-5 transition-colors duration-500 sm:w-7 ${i <= stage
                        ? "bg-gradient-to-r from-ember/70 to-ember/20"
                        : "bg-[rgb(236_229_218/0.12)]"
                      }`}
                  />
                )}
                <span className="flex items-center gap-1.5">
                  <span
                    className={`h-[7px] w-[7px] rounded-full transition-all duration-500 ${isActive
                        ? "animate-[breathe_1.6s_ease-in-out_infinite] bg-ember-hi shadow-[0_0_10px_var(--ember-glow)]"
                        : isDone
                          ? "bg-ember/60"
                          : "bg-[rgb(236_229_218/0.16)]"
                      }`}
                  />
                  <span
                    className={`font-mono text-[8.5px] uppercase tracking-[0.18em] transition-colors duration-500 ${isActive
                        ? "text-ember-hi"
                        : isDone
                          ? "text-stone/70"
                          : "text-stone/35"
                      }`}
                  >
                    {s.label}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

        <span key={stage} className="reach-text fx-fade">
          {STAGES[stage].phrase}…
        </span>
      </div>
    </div>
  );
}