import { Component, type ErrorInfo, type ReactNode } from "react";
import { Logo } from "./Logo";
import { Icon } from "./Icon";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface DustSpec {
  left: string;
  top: string;
  duration: string;
  delay: string;
  driftX: string;
  scale: number;
  cold: boolean;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  stack: string;
  copied: boolean;
  faultAt: number;
  now: number;
  dust: DustSpec[];
}

function buildDust(): DustSpec[] {
  return Array.from({ length: 16 }, (_, i) => ({
    left: `${(i * 61) % 100}%`,
    top: `${(i * 37 + 8) % 92}%`,
    duration: `${11 + ((i * 7) % 13)}s`,
    delay: `${-((i * 5) % 12)}s`,
    driftX: `${((i % 5) - 2) * 16}px`,
    scale: 0.5 + ((i % 4) * 0.22),
    cold: i % 3 === 0,
  }));
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private tick: ReturnType<typeof setInterval> | null = null;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      stack: "",
      copied: false,
      faultAt: 0,
      now: 0,
      dust: buildDust(),
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({
      stack: info.componentStack ?? "",
      faultAt: Date.now(),
      now: Date.now(),
    });
    // eslint-disable-next-line no-console
    console.error("[ContextOS] synapse snapped", error, info);
    if (this.tick) clearInterval(this.tick);
    this.tick = setInterval(() => this.setState({ now: Date.now() }), 1000);
  }

  componentWillUnmount() {
    if (this.tick) clearInterval(this.tick);
  }

  private clearCache = () => {
    try {
      if (typeof caches !== "undefined") {
        caches.keys().then((keys) => keys.forEach((key) => caches.delete(key)));
      }
    } catch {
      /* service worker cache unavailable */
    }
    try {
      localStorage.clear();
    } catch {
      /* storage blocked */
    }
    try {
      sessionStorage.clear();
    } catch {
      /* storage blocked */
    }
  };

  private goHome = () => {
    this.clearCache();
    window.location.replace("/");
  };

  private retry = () => {
    if (this.tick) clearInterval(this.tick);
    this.setState({ hasError: false, error: null, stack: "", copied: false, faultAt: 0 });
  };

  private wipeOnly = () => {
    this.clearCache();
    window.location.reload();
  };

  private copyReport = async () => {
    const { error, stack } = this.state;
    const text = `${error?.name ?? "Error"}: ${error?.message ?? ""}\n${stack}`.trim();
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
      window.setTimeout(() => this.setState({ copied: false }), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, stack, copied, faultAt, now, dust } = this.state;
    const elapsed = faultAt ? Math.floor((now - faultAt) / 1000) : 0;
    const code = (error?.name ?? "ERR").toUpperCase().slice(0, 6) || "ERR";

    return (
      <div className="relative min-h-screen overflow-hidden bg-void text-bone">
        <span className="landing-aura" aria-hidden="true" />

        <svg
          className="pointer-events-none absolute inset-0 h-full w-full opacity-50"
          viewBox="0 0 1200 800"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <path
            d="M-40 540 C 240 460, 420 600, 560 470"
            stroke="rgba(255, 138, 61, 0.22)"
            strokeWidth="1.4"
            fill="none"
          />
          <path
            className="fx-dash"
            d="M640 470 C 820 360, 980 520, 1240 420"
            stroke="rgba(255, 92, 73, 0.28)"
            strokeWidth="1.4"
            fill="none"
            strokeDasharray="5 11"
          />
          <circle className="fx-breathe" cx="560" cy="470" r="4" fill="rgba(255, 138, 61, 0.7)" />
          <circle className="fx-flicker" cx="640" cy="470" r="4" fill="rgba(255, 92, 73, 0.8)" />
          <circle
            className="fx-breathe"
            cx="980"
            cy="500"
            r="2.6"
            fill="rgba(143, 216, 210, 0.5)"
            style={{ animationDelay: "1.4s" }}
          />
        </svg>

        {dust.map((spec, i) => (
          <span
            key={i}
            className={`dust ${spec.cold ? "cold" : ""}`}
            style={{
              left: spec.left,
              top: spec.top,
              transform: `scale(${spec.scale})`,
              ["--drift-dur" as string]: spec.duration,
              ["--drift-delay" as string]: spec.delay,
              ["--drift-x" as string]: spec.driftX,
            }}
          />
        ))}

        <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-9 sm:py-6">
          <button
            onClick={this.goHome}
            className="inline-flex items-center gap-2.5 transition-opacity hover:opacity-80"
            aria-label="ContextOS home"
          >
            <Logo size={28} />
            <span className="font-display text-[17px] font-semibold tracking-[-0.01em] text-bone">
              Context<span className="text-ember">OS</span>
            </span>
          </button>
          <div className="flex items-center gap-2.5">
            <span className="h-1.5 w-1.5 flex-none rounded-full bg-flare fx-flicker" />
            <span className="t-mono text-[9px] uppercase tracking-[0.24em] text-stone">
              error boundary · active
            </span>
          </div>
        </header>

        <main className="relative z-10 mx-auto grid w-full max-w-[1180px] items-center gap-12 px-5 pb-20 pt-6 sm:px-9 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16 lg:pt-10">
          <section className="fx-rise">
            <p className="kicker">
              Signal lost · {code}
              <span className="t-mono ml-auto text-[9px] tracking-[0.2em] text-stone/60 lg:ml-4">
                +{elapsed}s
              </span>
            </p>
            <h1 className="font-display text-[clamp(40px,8vw,72px)] font-medium leading-[0.98] tracking-[-0.02em] text-bone">
              A synapse <em className="font-normal italic text-flare">snapped.</em>
            </h1>
            <p className="mt-6 max-w-md text-[15.5px] font-light leading-relaxed text-stone">
              The interface tripped over itself — a component redrew in a tight loop until React
              pulled the plug. Your memories are untouched in the vault. Reconnect to drop back to
              the home surface with a clean slate.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <button onClick={this.goHome} className="btn btn-primary">
                Take me home
                <Icon name="chevron" size={15} className="-rotate-90" />
              </button>
              <button onClick={this.retry} className="btn btn-ghost">
                <Icon name="refresh" size={14} />
                Retry this page
              </button>
            </div>

            <button
              onClick={this.wipeOnly}
              className="t-mono mt-5 inline-flex items-center gap-2 text-[9.5px] uppercase tracking-[0.2em] text-stone/70 transition-colors hover:text-ember-hi"
            >
              <span className="h-1 w-1 rounded-full bg-stone/50" />
              wipe local cache &amp; reload
            </button>
          </section>

          <section
            className="fx-rise relative overflow-hidden rounded-2xl border border-line-strong bg-coal/80 shadow-lift backdrop-blur-md"
            style={{ ["--rise-delay" as string]: "0.12s" }}
          >
            <span className="fx-scanline" aria-hidden="true" />
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex gap-1.5">
                  <i className="h-2 w-2 rounded-full bg-flare/70" />
                  <i className="h-2 w-2 rounded-full bg-ember/50" />
                  <i className="h-2 w-2 rounded-full bg-stone/30" />
                </span>
                <span className="t-mono text-[9px] uppercase tracking-[0.22em] text-stone">
                  fault report
                </span>
              </div>
              <button
                onClick={this.copyReport}
                className="t-mono inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[9px] uppercase tracking-[0.16em] text-stone transition-colors hover:border-line-strong hover:text-bone"
              >
                <Icon name={copied ? "check" : "copy"} size={11} />
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <div className="max-h-[44vh] overflow-y-auto px-5 py-4">
              <p className="text-[13.5px] font-light leading-relaxed text-bone/90">
                {error?.message ?? "An unknown error was caught by the boundary."}
              </p>
              {stack && (
                <pre className="t-mono mt-4 whitespace-pre-wrap break-words text-[10.5px] leading-relaxed text-stone/70">
                  {stack.trim()}
                </pre>
              )}
            </div>
            <div className="border-t border-line px-5 py-3">
              <p className="t-mono text-[8.5px] uppercase leading-relaxed tracking-[0.18em] text-stone/50">
                paste the component named above to your build partner — that is the loop to cut
              </p>
            </div>
          </section>
        </main>
      </div>
    );
  }
}