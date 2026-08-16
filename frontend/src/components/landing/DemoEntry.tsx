import { useEffect, useRef, useState } from "react";
import { useDemo } from "../../hooks/useDemo";
import { ROUTES } from "../../constants";
import { Icon } from "../shared/Icon";

const FEATURES = [
  {
    icon: "upload" as const,
    title: "Upload once",
    body: "PDF, DOCX, markdown, notes, and code are parsed and distilled a single time.",
  },
  {
    icon: "dive" as const,
    title: "Chat with memory",
    body: "Relevant memories are injected before the answer forms, with a visible trace.",
  },
  {
    icon: "cortex" as const,
    title: "Watch it wire",
    body: "Concepts become nodes, definitions become edges, and strength becomes heat.",
  },
];

const LIMITS = [
  { icon: "history" as const, label: "shared" },
  { icon: "upload" as const, label: "public uploads" },
  { icon: "dive" as const, label: "public chat" },
  { icon: "cortex" as const, label: "shared graph" },
];

export function DemoEntry() {
  const { launchSandbox, minting, error } = useDemo();
  const [launched, setLaunched] = useState(false);
  const redirectRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (redirectRef.current !== null) {
        window.clearTimeout(redirectRef.current);
      }
    };
  }, []);

  const handleLaunch = async () => {
    if (minting || launched) return;
    try {
      const success = await launchSandbox();
      if (success) {
        setLaunched(true);
        redirectRef.current = window.setTimeout(() => {
          window.location.replace(ROUTES.cortex);
        }, 700);
      }
    } catch {
      setLaunched(false);
    }
  };

  const status = minting
    ? "provisioning isolated memory space"
    : launched
      ? "handing you the keys"
      : "ready to ignite";

  return (
    <section className="section" id="demo">
      <div className="section-head">
        <p className="sec-kicker">Live sandbox</p>
        <h2 className="sec-title">
          Try it now. <em>No signup.</em>
        </h2>
        <p className="sec-sub">
          Upload a paper, chat with it, and watch the graph build in real time.
          A shared public memory space. Upload, chat, and see what everyone builds together.
        </p>
      </div>

      <div className="demo-shell fx-rise">
        <span className="demo-aura" aria-hidden="true" />
        <span className="demo-grid" aria-hidden="true" />

        <div className="demo-inner">
          <div className="demo-left">
            <span className="demo-badge">
              <span className="demo-badge-dot fx-pulse-soft" />
              live environment
            </span>

            <h3 className="demo-title">
              Ignite a disposable <em>second brain.</em>
            </h3>

            <p className="demo-sub">
              This is a real ContextOS environment, not a mock. It extracts,
              embeds, retrieves, and decays exactly like the production system,
              then evaporates without leaving a trace.
            </p>

            <div className="demo-features">
              {FEATURES.map((feature) => (
                <article key={feature.title} className="demo-feature">
                  <span className="demo-feature-icon">
                    <Icon name={feature.icon} size={18} />
                  </span>
                  <div>
                    <h4>{feature.title}</h4>
                    <p>{feature.body}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="demo-limits">
              {LIMITS.map((limit) => (
                <span key={limit.label} className="demo-chip">
                  <Icon name={limit.icon} size={13} />
                  {limit.label}
                </span>
              ))}
            </div>
          </div>

          <div className="demo-console">
            <div className="demo-orbit" aria-hidden="true">
              <span className="demo-orbit-core" />
              <span className="demo-orbit-ring r1">
                <span className="demo-satellite" />
              </span>
              <span className="demo-orbit-ring r2">
                <span className="demo-satellite" />
              </span>
              <span className="demo-orbit-ring r3">
                <span className="demo-satellite" />
              </span>
            </div>

            <div className="demo-console-body">
              <p className="demo-status" aria-live="polite">
                {status}
              </p>

              <button
                className="demo-button"
                onClick={() => void handleLaunch()}
                disabled={minting || launched}
              >
                {minting ? (
                  <>
                    <span className="h-2 w-2 animate-ping rounded-full bg-current" />
                    Igniting sandbox…
                  </>
                ) : launched ? (
                  <>
                    <Icon name="check" size={16} />
                    Entering…
                  </>
                ) : (
                  <>
                    <Icon name="spark" size={16} />
                    Launch live sandbox
                  </>
                )}
              </button>

              {error && <p className="demo-error">{error}</p>}

              {launched && !error && (
                <p className="demo-success">Sandbox ignited. Entering Cortex…</p>
              )}

              <p className="demo-note">
                Shared public demo. Everyone sees the same memories, documents, and graph.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}