import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuthContext } from "../auth/AuthProvider";
import { ROUTES } from "../constants";
import { Logo } from "../components/shared/Logo";
import { Icon } from "../components/shared/Icon";
import { HeroGraph } from "../components/landing/HeroGraph";
import { DecayDemo } from "../components/landing/DecayDemo";
import { MiniGraph } from "../components/landing/MiniGraph";
import { DemoEntry } from "../components/landing/DemoEntry";
import { MobileLandingPage } from "./MobileLandingPage";
import { ScrambleText, Tilt } from "../components/landing/mobile/fx";

function useReveal<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let done = false;
    const scroller = el.closest(".landing") as HTMLElement | null;
    const target: EventTarget = scroller ?? window;
    const inView = () => {
      const rect = el.getBoundingClientRect();
      return rect.top < window.innerHeight * 0.92 && rect.bottom > 0;
    };
    let io: IntersectionObserver | null = null;
    let raf = 0;
    let timer = 0;
    const cleanup = () => {
      if (io) io.disconnect();
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.clearTimeout(timer);
    };
    const reveal = () => {
      if (done) return;
      done = true;
      el.classList.add("is-in");
      cleanup();
    };
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            reveal();
            break;
          }
        }
      },
      { root: scroller, threshold: 0, rootMargin: "0px 0px -6% 0px" }
    );
    io.observe(el);
    let ticking = false;
    const onScroll = () => {
      if (ticking || done) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        if (inView()) reveal();
      });
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    raf = window.requestAnimationFrame(() => {
      if (inView()) reveal();
    });
    timer = window.setTimeout(() => {
      if (inView()) reveal();
    }, 1200);
    return () => {
      window.cancelAnimationFrame(raf);
      cleanup();
    };
  }, []);
  return ref;
}

function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} className={`reveal ${className}`} style={{ "--reveal-delay": `${delay}s` } as CSSProperties}>
      {children}
    </div>
  );
}

function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const duration = 1500;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return (
    <>
      {display.toLocaleString("en-US")}
      {suffix}
    </>
  );
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Typed({ text, play, speed = 26, onDone }: { text: string; play: boolean; speed?: number; onDone?: () => void }) {
  const [n, setN] = useState(0);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (!play) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length) {
        window.clearInterval(id);
        doneRef.current?.();
      }
    }, speed);
    return () => window.clearInterval(id);
  }, [play, text, speed]);
  return (
    <>
      {text.slice(0, n)}
      {play && n < text.length ? <span className="type-caret" /> : null}
    </>
  );
}

const DIVE_SCENARIOS = [
  {
    q: "what did we decide about the cache?",
    a: "You moved it to a partitioned LRU to kill the repeated reads…",
    traces: ["Partitioned Cache", "Repeated Read Pattern"],
    budget: 4,
  },
  {
    q: "why did we pick CockroachDB?",
    a: "Serializable isolation plus a distributed vector index in one store…",
    traces: ["CockroachDB Choice", "Vector Index"],
    budget: 3,
  },
  {
    q: "what is fading this week?",
    a: "GRPO training details sit at 38% — worth a refresh…",
    traces: ["GRPO Training", "Decay Model"],
    budget: 5,
  },
];

function DiveLive() {
  const [si, setSi] = useState(0);
  const [stage, setStage] = useState<"q" | "sweep" | "a" | "hold">("q");
  useEffect(() => {
    if (stage === "sweep") {
      const t = window.setTimeout(() => setStage("a"), 1300);
      return () => window.clearTimeout(t);
    }
    if (stage === "hold") {
      const t = window.setTimeout(() => {
        setSi((s) => (s + 1) % DIVE_SCENARIOS.length);
        setStage("q");
      }, 2600);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [stage]);
  const sc = DIVE_SCENARIOS[si];
  return (
    <div className="dive-live" aria-hidden="true">
      <div className="dl-top">
        <span className="dl-live-dot fx-breathe" />
        <span className="dl-label">live retrieval</span>
        <span className="dl-budget">
          <span className="dl-budget-fill" style={{ width: `${(sc.budget / 20) * 100}%` }} />
        </span>
        <span className="dl-budget-num">{sc.budget}/20</span>
      </div>
      <div className="dl-bubble dl-bubble-user">
        <span className="dl-role">you</span>
        <Typed key={`q${si}`} text={sc.q} play onDone={() => setStage("sweep")} />
      </div>
      <div className={`dl-trace ${stage !== "q" ? "on" : ""}`}>
        {sc.traces.map((t, i) => (
          <span key={t} className="dl-chip" style={{ transitionDelay: `${i * 0.28}s` }}>
            <b>{i + 1}</b> {t}
          </span>
        ))}
        <span className="dl-sweep-label">graph swept · 2 hops</span>
      </div>
      <div className={`dl-bubble dl-bubble-ai ${stage === "a" || stage === "hold" ? "on" : ""}`}>
        <span className="fx-scanline" />
        <span className="dl-role">cortex</span>
        <Typed
          key={`a${si}`}
          text={sc.a}
          play={stage === "a" || stage === "hold"}
          onDone={() => setStage("hold")}
        />
      </div>
    </div>
  );
}

const NAV_LINKS = [
  { label: "The model", id: "decay" },
  { label: "How it works", id: "how" },
  { label: "Surfaces", id: "surfaces" },
  { label: "The engine", id: "engine" },
];

const TITLE: Array<{ t: string; accent?: boolean }> = [
  { t: "A second brain that" },
  { t: "remembers", accent: true },
  { t: "and stays honest about" },
  { t: "forgetting.", accent: true },
];

const MARQUEE = [
  "Extraction happens once",
  "Retrieval is free forever",
  "Forgetting is visible by design",
  "Strength reads as temperature",
  "One database holds the whole mind",
  "Decay is a feature, not a bug",
];

const PIPE = [
  {
    idx: "01",
    icon: "upload" as const,
    title: "Feed it anything",
    body: "Drop in a paper, a document, a transcript, or a repository. PDF, DOCX, markdown, and code are parsed locally, structured by type, and never read a second time. Not one token is spent on the way in.",
  },
  {
    idx: "02",
    icon: "spark" as const,
    title: "Distill, exactly once",
    body: "A single pass through Nova extracts the concepts worth keeping, each with a definition, a reason it matters, and the edges that connect it to the rest. One call, and the work is done for good.",
  },
  {
    idx: "03",
    icon: "cortex" as const,
    title: "Wire it and embed it",
    body: "Every concept becomes a node carrying a vector of 1024 dimensions from Titan, a bucket, and a synapse. The distributed vector index of CockroachDB places it on the map, transactionally and atomically.",
  },
  {
    idx: "04",
    icon: "search" as const,
    title: "Retrieve, for free",
    body: "From that point on, every question sweeps vector, text, and graph search in parallel, and the relevant memories ignite into the answer. Nothing is reread. Nothing is paid for twice. Ever.",
  },
];

const ENGINE = [
  {
    idx: "01",
    title: "Embeddings, generated once",
    body: "Each concept becomes a vector of 1024 dimensions from Amazon Titan Embed Text v2, computed in parallel the instant a document lands. One pass in, and the geometry of your knowledge is fixed for good.",
  },
  {
    idx: "02",
    title: "Three searches, one ranked answer",
    body: "Every question fires semantic nearest neighbour search over the distributed vector index, exact text matching, and graph expansion across two hops at the same time. The candidates are merged and ranked by a softmax over semantic similarity, memory strength, and recency, so the freshest and most relevant memories rise to the top.",
  },
  {
    idx: "03",
    title: "Memory that ages the way yours does",
    body: "Strength is temperature. Reaching for a memory reignites it, while leaving it alone lets it cool, visibly and on purpose, all the way to ash. Nothing is ever lost in silence, and everything can be brought back.",
  },
];

export function LandingPage() {
  const { isAuthenticated, initializing } = useAuthContext();
  const authed = isAuthenticated && !initializing;
  if (typeof window !== "undefined" && window.innerWidth < 768) {
    return <MobileLandingPage />;
  }
  return (
    <div className="landing">
      <span className="landing-aura" aria-hidden="true" />
      <header className="l-nav">
        <div className="l-nav-inner">
          <button className="l-brand" onClick={() => scrollToId("top")} aria-label="ContextOS home">
            <Logo size={30} />
            <span className="l-wordmark">
              Context<span className="l-wordmark-accent">OS</span>
            </span>
          </button>
          <nav className="l-nav-links">
            {NAV_LINKS.map((link) => (
              <button key={link.id} className="l-nav-link" onClick={() => scrollToId(link.id)}>
                {link.label}
              </button>
            ))}
          </nav>
          <div className="l-nav-cta">
            {authed ? (
              <Link to={ROUTES.dive} className="l-cta l-cta-primary">
                Enter the Dive
                <Icon name="dive" size={14} className="l-cta-arrow" />
              </Link>
            ) : (
              <>
                <Link to={ROUTES.login} className="l-cta l-cta-ghost l-hide-sm">
                  Sign in
                </Link>
                <Link to={ROUTES.signup} className="l-cta l-cta-primary">
                  Start free
                </Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="top">
        <section className="hero">
          <HeroGraph />
          <span className="hero-veil" aria-hidden="true" />
          <div className="hero-shell">
            <div className="hero-copy">
              <p className="hero-kicker">
                <span className="hero-kicker-dot" />
                <ScrambleText text="Persistent memory for AI" />
              </p>
              <h1 className="hero-title">
                {TITLE.map((part, i) =>
                  part.accent ? (
                    <em key={i} className="hero-word fx-rise" style={{ "--rise-delay": `${0.1 + i * 0.08}s` } as CSSProperties}>
                      {part.t}
                    </em>
                  ) : (
                    <span key={i} className="hero-word fx-rise" style={{ "--rise-delay": `${0.1 + i * 0.08}s` } as CSSProperties}>
                      {part.t}
                    </span>
                  )
                )}
              </h1>
              <p className="hero-sub fx-rise" style={{ "--rise-delay": "0.5s" } as CSSProperties}>
                ContextOS distills every document and conversation into a{" "}
                <strong>living knowledge graph</strong>, exactly once. From then on,{" "}
                <strong>retrieval costs nothing</strong>, and each memory carries a strength that
                cools with neglect and <em>reignites with use</em>, so the system never pretends
                to know what you have let go.
              </p>
              <div className="hero-actions fx-rise" style={{ "--rise-delay": "0.62s" } as CSSProperties}>
                {authed ? (
                  <Link to={ROUTES.dive} className="l-cta l-cta-primary l-cta-lg">
                    Enter the Dive
                    <Icon name="dive" size={15} className="l-cta-arrow" />
                  </Link>
                ) : (
                  <Link to={ROUTES.signup} className="l-cta l-cta-primary l-cta-lg">
                    Start free
                    <Icon name="plus" size={15} className="l-cta-arrow" />
                  </Link>
                )}
                <button className="l-cta l-cta-ghost l-cta-lg" onClick={() => scrollToId("decay")}>
                  <Icon name="spark" size={15} />
                  See it forget
                </button>
              </div>
              <div className="hero-ticker fx-rise" style={{ "--rise-delay": "0.74s" } as CSSProperties}>
                <span className="ticker-live">
                  <span className="ticker-live-dot fx-breathe" />
                  system snapshot
                </span>
                <span className="ticker-item">
                  <span className="ticker-val hot">
                    <CountUp value={1204} />
                  </span>
                  <span className="ticker-label">memories alive</span>
                </span>
                <span className="ticker-sep" />
                <span className="ticker-item">
                  <span className="ticker-val">
                    <CountUp value={64} suffix="%" />
                  </span>
                  <span className="ticker-label">average strength</span>
                </span>
                <span className="ticker-sep" />
                <span className="ticker-item">
                  <span className="ticker-val cold">
                    <CountUp value={2318} />
                  </span>
                  <span className="ticker-label">synapses</span>
                </span>
                <span className="ticker-caret fx-blink" />
              </div>
            </div>
          </div>
          <span className="hero-graph-tag hero-graph-tag-tl">
            <span className="hero-graph-tag-dot fx-breathe" />
            live memory field
          </span>
          <span className="hero-graph-tag hero-graph-tag-br">heat encodes strength</span>
          <button className="scroll-cue" onClick={() => scrollToId("decay")} aria-label="Scroll down">
            <span className="scroll-cue-mouse">
              <span className="scroll-cue-wheel" />
            </span>
            <span className="scroll-cue-label">watch a memory cool</span>
          </button>
        </section>
        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            {[...MARQUEE, ...MARQUEE].map((phrase, i) => (
              <span key={i} className={`marquee-item ${i % 2 === 1 ? "marquee-item-outline" : ""}`}>
                {phrase}
                <span className="marquee-star">✦</span>
              </span>
            ))}
          </div>
        </div>
        <section className="section" id="decay">
          <div className="section-head">
            <Reveal>
              <p className="sec-kicker">
                <span className="sec-kicker-idx">01</span>
                <ScrambleText text="The memory model" />
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="sec-title">
                Strength is <em>temperature.</em>
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="sec-sub">
                One instrument, not four boxes. Pick a memory on the rail, read its live decay
                curve on the stage, and watch the dial cool — until you reach for it again.
              </p>
            </Reveal>
          </div>
          <Reveal delay={0.1}>
            <DecayDemo />
          </Reveal>
        </section>
        <section className="section" id="how">
          <div className="section-head section-head-left">
            <Reveal>
              <p className="sec-kicker">
                <span className="sec-kicker-idx">02</span>
                <ScrambleText text="The pipeline" />
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="sec-title">
                One pass in. <em>Free</em> forever after.
              </h2>
            </Reveal>
          </div>
          <div className="pipe">
            <span className="pipe-line" aria-hidden="true" />
            {PIPE.map((step, i) => (
              <Reveal key={step.idx} delay={i * 0.06}>
                <div className={`pipe-step ${i % 2 === 1 ? "pipe-step-r" : ""}`}>
                  <span className="pipe-node">
                    <span className="pipe-node-ring fx-pulse-ring" />
                    <Icon name={step.icon} size={18} />
                  </span>
                  <div className="pipe-body">
                    <span className="pipe-idx">{step.idx}</span>
                    <h3 className="pipe-title">{step.title}</h3>
                    <p className="pipe-text">{step.body}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.1}>
            <p className="pipe-close">
              <span className="pipe-close-dot fx-flicker" />
              And when you stop using a memory, it does not linger in silence. It cools, on screen,
              until you choose to bring it back.
            </p>
          </Reveal>
        </section>
        <section className="section" id="surfaces">
          <div className="section-head">
            <Reveal>
              <p className="sec-kicker">
                <span className="sec-kicker-idx">03</span>
                <ScrambleText text="Two surfaces, one engine" />
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="sec-title">
                Read it as a <em>place.</em> Talk to it as a <em>mind.</em>
              </h2>
            </Reveal>
          </div>
          <div className="surf-grid">
            <Reveal>
              <Tilt>
                <article className="surf-panel surf-panel-ember">
                  <span className="surf-aura" aria-hidden="true" />
                  <p className="surf-kicker">The Cortex</p>
                  <h3 className="surf-title">The graph, as a sky you can steer.</h3>
                  <p className="surf-sub">
                    Three ways to read the same mind. Orbit lays strength out as a solar system,
                    constellation groups concepts into galaxies by type, and timeline orders them by
                    date with a glowing NOW line. Size is weight and heat is strength, legible at a
                    glance, even on a projector.
                  </p>
                  <ul className="surf-list">
                    <li>drag a node and it pins exactly where you leave it</li>
                    <li>search clears the active filter, then flies you in</li>
                    <li>critical memories flicker red and forgotten ones go to ash</li>
                  </ul>
                  <MiniGraph />
                </article>
              </Tilt>
            </Reveal>
            <Reveal delay={0.12}>
              <Tilt>
                <article className="surf-panel surf-panel-mineral">
                  <span className="surf-aura surf-aura-mineral" aria-hidden="true" />
                  <p className="surf-kicker surf-kicker-mineral">The Dive</p>
                  <h3 className="surf-title">Memory injected chat.</h3>
                  <p className="surf-sub">
                    Ask anything. The graph is swept in parallel, the memories that answer ignite and
                    join the reply, and a numbered trace cites exactly what was used, so you always
                    see the mind thinking.
                  </p>
                  <ul className="surf-list">
                    <li>retrieval adds a fraction of a cent per message, on top of the chat itself</li>
                    <li>the trace is tappable and jumps straight to the node</li>
                    <li>your reply is distilled back into the graph</li>
                  </ul>
                  <DiveLive />
                </article>
              </Tilt>
            </Reveal>
          </div>
        </section>
        <section className="section" id="engine">
          <div className="section-head">
            <Reveal>
              <p className="sec-kicker">
                <span className="sec-kicker-idx">04</span>
                <ScrambleText text="The engine" />
              </p>
            </Reveal>
            <Reveal delay={0.08}>
              <h2 className="sec-title">
                The intelligence, <em>not</em> the plumbing.
              </h2>
            </Reveal>
            <Reveal delay={0.16}>
              <p className="sec-sub">Three ideas do the heavy lifting. Everything else is simply where they live.</p>
            </Reveal>
          </div>
          <div className="engine-grid">
            {ENGINE.map((card, i) => (
              <Reveal key={card.idx} delay={i * 0.08}>
                <Tilt max={4}>
                  <article className="engine-card">
                    <span className="engine-num">{card.idx}</span>
                    <h3 className="engine-title">{card.title}</h3>
                    <p className="engine-body">{card.body}</p>
                  </article>
                </Tilt>
              </Reveal>
            ))}
          </div>
          <Reveal delay={0.12}>
            <p className="engine-substrate">
              All of it runs on a single CockroachDB cluster that holds the buckets, the vectors,
              the edges, and the transactions in one place. Amazon Bedrock supplies the reasoning
              through Nova Pro and Nova Lite, and Amazon S3 seals the originals.
            </p>
          </Reveal>
        </section>
        <DemoEntry />
        <section className="cta-band">
          <span className="cta-aura" aria-hidden="true" />
          <Reveal>
            <p className="sec-kicker sec-kicker-center">
              <ScrambleText text="Open the archive" />
            </p>
          </Reveal>
          <Reveal delay={0.08}>
            <h2 className="cta-title">
              Give your AI a memory that <em>ages like yours.</em>
            </h2>
          </Reveal>
          <Reveal delay={0.16}>
            <p className="cta-sub">
              Free to start, honest about forgetting, and built so retrieval never charges you twice.
            </p>
          </Reveal>
          <Reveal delay={0.24}>
            <div className="cta-actions">
              {authed ? (
                <Link to={ROUTES.dive} className="l-cta l-cta-primary l-cta-lg">
                  Enter the Dive
                  <Icon name="dive" size={15} className="l-cta-arrow" />
                </Link>
              ) : (
                <Link to={ROUTES.signup} className="l-cta l-cta-primary l-cta-lg">
                  Start free
                  <Icon name="plus" size={15} className="l-cta-arrow" />
                </Link>
              )}
              <Link to={ROUTES.login} className="l-cta l-cta-ghost l-cta-lg">
                <Icon name="dive" size={15} />
                Sign in
              </Link>
            </div>
          </Reveal>
        </section>
      </main>
    </div>
  );
}