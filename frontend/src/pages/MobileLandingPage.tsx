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

function usePrefersReducedMotion() {
    const [reduced, setReduced] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        setReduced(mq.matches);

        const onChange = (event: MediaQueryListEvent) => {
            setReduced(event.matches);
        };

        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, []);

    return reduced;
}

function Reveal({
    children,
    delay = 0,
    className = "",
}: {
    children: ReactNode;
    delay?: number;
    className?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        const scroller = el.closest(".ml-page") as HTMLElement | null;

        const io = new IntersectionObserver(
            (entries) => {
                for (const entry of entries) {
                    if (entry.isIntersecting) {
                        el.classList.add("is-in");
                        io.disconnect();
                    }
                }
            },
            { root: scroller, threshold: 0.08, rootMargin: "0px 0px -8% 0px" }
        );

        io.observe(el);

        const fallback = window.setTimeout(() => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight * 0.95 && rect.bottom > 0) {
                el.classList.add("is-in");
                io.disconnect();
            }
        }, 1200);

        return () => {
            io.disconnect();
            window.clearTimeout(fallback);
        };
    }, []);

    return (
        <div
            ref={ref}
            className={`ml-reveal ${className}`.trim()}
            style={{ "--rd": `${delay}s` } as CSSProperties}
        >
            {children}
        </div>
    );
}

function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
    const reducedMotion = usePrefersReducedMotion();
    const [display, setDisplay] = useState(0);

    useEffect(() => {
        if (reducedMotion) {
            setDisplay(value);
            return;
        }

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
    }, [value, reducedMotion]);

    return (
        <>
            {display.toLocaleString("en-US")}
            {suffix}
        </>
    );
}

function scrollToId(id: string) {
    const el = document.getElementById(id);
    if (!el) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

function Typed({
    text,
    play,
    speed = 26,
    onDone,
}: {
    text: string;
    play: boolean;
    speed?: number;
    onDone?: () => void;
}) {
    const [n, setN] = useState(play ? 0 : text.length);
    const doneRef = useRef(onDone);
    doneRef.current = onDone;

    useEffect(() => {
        if (!play) {
            setN(text.length);
            const t = window.setTimeout(() => doneRef.current?.(), 80);
            return () => window.clearTimeout(t);
        }

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
        body: "Drop in a paper, a document, a transcript, or a repository. PDF, DOCX, markdown, and code are parsed locally, structured by type, and never read a second time.",
    },
    {
        idx: "02",
        icon: "spark" as const,
        title: "Distill, exactly once",
        body: "A single pass extracts the concepts worth keeping, each with a definition, a reason it matters, and the edges that connect it to the rest.",
    },
    {
        idx: "03",
        icon: "cortex" as const,
        title: "Wire it and embed it",
        body: "Every concept becomes a node carrying a vector, a bucket, and a synapse. CockroachDB places it on the map, transactionally and atomically.",
    },
    {
        idx: "04",
        icon: "search" as const,
        title: "Retrieve, for free",
        body: "Every question sweeps vector, text, and graph search in parallel. Nothing is reread. Nothing is paid for twice. Ever.",
    },
];

const ENGINE = [
    {
        idx: "01",
        title: "Embeddings, generated once",
        body: "Each concept becomes a vector, computed in parallel the instant a document lands. One pass in, and the geometry of your knowledge is fixed for good.",
    },
    {
        idx: "02",
        title: "Three searches, one ranked answer",
        body: "Every question fires semantic nearest neighbour search, exact text matching, and graph expansion across two hops at the same time. Candidates are ranked by similarity, strength, and recency.",
    },
    {
        idx: "03",
        title: "Memory that ages the way yours does",
        body: "Strength is temperature. Reaching for a memory reignites it, while leaving it alone lets it cool, visibly and on purpose, all the way to ash.",
    },
];

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
        a: "GRPO training details sit at 38% and are worth a refresh…",
        traces: ["GRPO Training", "Decay Model"],
        budget: 5,
    },
];

function DiveLive() {
    const reducedMotion = usePrefersReducedMotion();
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
                <Typed key={`q${si}`} text={sc.q} play={!reducedMotion} onDone={() => setStage("sweep")} />
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
                {(stage === "a" || stage === "hold") && (
                    <Typed key={`a${si}`} text={sc.a} play={!reducedMotion} onDone={() => setStage("hold")} />
                )}
            </div>
        </div>
    );
}

export function MobileLandingPage() {
    const { isAuthenticated, initializing } = useAuthContext();
    const authed = isAuthenticated && !initializing;

    return (
        <div className="ml-page">
            <span className="ml-page-aura" aria-hidden="true" />

            <header className="ml-nav">
                <div className="ml-nav-top">
                    <Link to="/" className="ml-brand" aria-label="ContextOS home">
                        <Logo size={26} />
                        <span className="ml-wordmark">
                            Context<span className="ml-wordmark-accent">OS</span>
                        </span>
                    </Link>

                    <div className="ml-nav-actions">
                        {authed ? (
                            <Link to={ROUTES.dive} className="ml-btn ml-btn-primary ml-btn-nav">
                                Enter Dive
                            </Link>
                        ) : (
                            <>
                                <Link to={ROUTES.login} className="ml-btn ml-btn-ghost ml-btn-nav">
                                    Sign in
                                </Link>
                                <Link to={ROUTES.signup} className="ml-btn ml-btn-primary ml-btn-nav">
                                    Start free
                                </Link>
                            </>
                        )}
                    </div>
                </div>
            </header>

            <main id="ml-main" className="ml-main">
                <section className="ml-hero" id="ml-top">
                    <span className="ml-hero-graph" aria-hidden="true">
                        <HeroGraph />
                    </span>
                    <span className="ml-hero-veil" aria-hidden="true" />

                    <div className="ml-hero-content">
                        <Reveal>
                            <p className="ml-kicker">
                                <span className="ml-kicker-dot fx-pulse-soft" />
                                Persistent memory for AI
                            </p>
                        </Reveal>

                        <Reveal delay={0.08}>
                            <h1 className="ml-title">
                                {TITLE.map((part, i) =>
                                    part.accent ? (
                                        <em
                                            key={i}
                                            className="ml-word fx-rise"
                                            style={{ "--rise-delay": `${0.1 + i * 0.08}s` } as CSSProperties}
                                        >
                                            {part.t}
                                        </em>
                                    ) : (
                                        <span
                                            key={i}
                                            className="ml-word fx-rise"
                                            style={{ "--rise-delay": `${0.1 + i * 0.08}s` } as CSSProperties}
                                        >
                                            {part.t}
                                        </span>
                                    )
                                )}
                            </h1>
                        </Reveal>

                        <Reveal delay={0.16}>
                            <p className="ml-sub">
                                ContextOS distills every document and conversation into a{" "}
                                <strong>living knowledge graph</strong>, exactly once. From then on,{" "}
                                <strong>retrieval costs nothing</strong>, and each memory cools with neglect and{" "}
                                <em>reignites with use</em>.
                            </p>
                        </Reveal>

                        <Reveal delay={0.24}>
                            <div className="ml-actions">
                                {authed ? (
                                    <Link to={ROUTES.dive} className="ml-btn ml-btn-primary ml-btn-lg">
                                        Enter the Dive
                                        <Icon name="dive" size={14} />
                                    </Link>
                                ) : (
                                    <Link to={ROUTES.signup} className="ml-btn ml-btn-primary ml-btn-lg">
                                        Start free
                                        <Icon name="plus" size={14} />
                                    </Link>
                                )}

                                <button
                                    type="button"
                                    className="ml-btn ml-btn-ghost ml-btn-lg"
                                    onClick={() => scrollToId("ml-decay")}
                                >
                                    <Icon name="spark" size={14} />
                                    See it forget
                                </button>
                            </div>
                        </Reveal>

                        <Reveal delay={0.32}>
                            <div className="ml-ticker">
                                <span className="ml-ticker-live">
                                    <span className="ml-ticker-dot fx-breathe" />
                                    system snapshot
                                </span>

                                <span className="ml-ticker-sep" />

                                <span className="ml-ticker-item">
                                    <span className="ml-ticker-val ml-hot">
                                        <CountUp value={1204} />
                                    </span>
                                    <span className="ml-ticker-label">memories</span>
                                </span>

                                <span className="ml-ticker-sep" />

                                <span className="ml-ticker-item">
                                    <span className="ml-ticker-val">
                                        <CountUp value={64} suffix="%" />
                                    </span>
                                    <span className="ml-ticker-label">strength</span>
                                </span>

                                <span className="ml-ticker-sep" />

                                <span className="ml-ticker-item">
                                    <span className="ml-ticker-val ml-cold">
                                        <CountUp value={2318} />
                                    </span>
                                    <span className="ml-ticker-label">synapses</span>
                                </span>

                                <span className="ml-ticker-caret fx-blink" aria-hidden="true" />
                            </div>
                        </Reveal>
                    </div>

                    <button
                        type="button"
                        className="ml-scroll-cue"
                        onClick={() => scrollToId("ml-decay")}
                        aria-label="Scroll to memory model"
                    >
                        <span className="ml-scroll-cue-line" aria-hidden="true" />
                        <span className="ml-scroll-cue-label">watch a memory cool</span>
                    </button>
                </section>

                <div className="ml-marquee" aria-hidden="true">
                    <div className="ml-marquee-track">
                        {[...MARQUEE, ...MARQUEE].map((phrase, i) => (
                            <span
                                key={i}
                                className={`ml-marquee-item ${i % 2 === 1 ? "ml-marquee-item-alt" : ""}`}
                            >
                                {phrase}
                                <span className="ml-marquee-star">✦</span>
                            </span>
                        ))}
                    </div>
                </div>

                <section className="ml-section" id="ml-decay">
                    <div className="ml-section-head">
                        <Reveal>
                            <p className="ml-kicker">The memory model</p>
                        </Reveal>
                        <Reveal delay={0.08}>
                            <h2 className="ml-section-title">
                                Strength is <em>temperature.</em>
                            </h2>
                        </Reveal>
                        <Reveal delay={0.16}>
                            <p className="ml-section-sub">
                                One instrument, not four boxes. Pick a memory on the rail, read its live decay
                                curve on the stage, and watch the dial cool until you reach for it again.
                            </p>
                        </Reveal>
                    </div>

                    <Reveal delay={0.1}>
                        <div className="ml-decay-wrap">
                            <DecayDemo />
                        </div>
                    </Reveal>
                </section>

                <section className="ml-section" id="ml-how">
                    <div className="ml-section-head ml-section-head-left">
                        <Reveal>
                            <p className="ml-kicker">The pipeline</p>
                        </Reveal>
                        <Reveal delay={0.08}>
                            <h2 className="ml-section-title">
                                One pass in. <em>Free</em> forever after.
                            </h2>
                        </Reveal>
                    </div>

                    <div className="ml-pipe-steps">
                        {PIPE.map((step, i) => (
                            <Reveal key={step.idx} delay={i * 0.06}>
                                <div className="ml-pipe-step">
                                    <span className="ml-pipe-node">
                                        <Icon name={step.icon} size={16} />
                                    </span>
                                    <div className="ml-pipe-body">
                                        <span className="ml-pipe-idx">{step.idx}</span>
                                        <h3 className="ml-pipe-title">{step.title}</h3>
                                        <p className="ml-pipe-text">{step.body}</p>
                                    </div>
                                </div>
                            </Reveal>
                        ))}
                    </div>

                    <Reveal delay={0.1}>
                        <p className="ml-pipe-close">
                            <span className="ml-pipe-close-dot fx-flicker" />
                            And when you stop using a memory, it does not linger in silence. It cools, on
                            screen, until you choose to bring it back.
                        </p>
                    </Reveal>
                </section>

                <section className="ml-section" id="ml-surfaces">
                    <div className="ml-section-head">
                        <Reveal>
                            <p className="ml-kicker">Two surfaces, one engine</p>
                        </Reveal>
                        <Reveal delay={0.08}>
                            <h2 className="ml-section-title">
                                Read it as a <em>place.</em> Talk to it as a <em>mind.</em>
                            </h2>
                        </Reveal>
                    </div>

                    <div className="ml-surf-cards">
                        <Reveal>
                            <article className="ml-surf-card ml-surf-ember">
                                <span className="ml-surf-aura" aria-hidden="true" />
                                <p className="ml-surf-kicker">The Cortex</p>
                                <h3 className="ml-surf-name">The graph, as a sky you can steer.</h3>
                                <p className="ml-surf-desc">
                                    Orbit lays strength out as a solar system, constellation groups concepts into
                                    galaxies by type, and timeline orders them by date with a glowing NOW line.
                                </p>
                                <ul className="ml-surf-list">
                                    <li>drag a node and it pins exactly where you leave it</li>
                                    <li>search clears the active filter, then flies you in</li>
                                    <li>critical memories flicker red and forgotten ones go to ash</li>
                                </ul>
                                <MiniGraph />
                            </article>
                        </Reveal>

                        <Reveal delay={0.12}>
                            <article className="ml-surf-card ml-surf-mineral">
                                <span className="ml-surf-aura ml-surf-aura-mineral" aria-hidden="true" />
                                <p className="ml-surf-kicker ml-surf-kicker-mineral">The Dive</p>
                                <h3 className="ml-surf-name">Memory injected chat.</h3>
                                <p className="ml-surf-desc">
                                    The graph is swept in parallel, the memories that answer ignite and join the
                                    reply, and a numbered trace cites exactly what was used.
                                </p>
                                <ul className="ml-surf-list ml-surf-list-mineral">
                                    <li>retrieval adds a fraction of a cent per message</li>
                                    <li>the trace is tappable and jumps straight to the node</li>
                                    <li>your reply is distilled back into the graph</li>
                                </ul>
                                <DiveLive />
                            </article>
                        </Reveal>
                    </div>
                </section>

                <section className="ml-section" id="ml-engine">
                    <div className="ml-section-head">
                        <Reveal>
                            <p className="ml-kicker">The engine</p>
                        </Reveal>
                        <Reveal delay={0.08}>
                            <h2 className="ml-section-title">
                                The intelligence, <em>not</em> the plumbing.
                            </h2>
                        </Reveal>
                        <Reveal delay={0.16}>
                            <p className="ml-section-sub">
                                Three ideas do the heavy lifting. Everything else is simply where they live.
                            </p>
                        </Reveal>
                    </div>

                    <div className="ml-engine-cards">
                        {ENGINE.map((card, i) => (
                            <Reveal key={card.idx} delay={i * 0.08}>
                                <div className="ml-engine-card">
                                    <span className="ml-engine-num">{card.idx}</span>
                                    <h3 className="ml-engine-name">{card.title}</h3>
                                    <p className="ml-engine-body">{card.body}</p>
                                </div>
                            </Reveal>
                        ))}
                    </div>

                    <Reveal delay={0.12}>
                        <p className="ml-engine-substrate">
                            All of it runs on a single CockroachDB cluster. Amazon Bedrock supplies the
                            reasoning through Nova Pro and Nova Lite, and Amazon S3 seals the originals.
                        </p>
                    </Reveal>
                </section>

                <section className="ml-section ml-demo-section" id="ml-demo">
                    <Reveal>
                        <DemoEntry />
                    </Reveal>
                </section>

                <section className="ml-cta">
                    <Reveal>
                        <p className="ml-kicker ml-kicker-center">Open the archive</p>
                    </Reveal>
                    <Reveal delay={0.08}>
                        <h2 className="ml-cta-title">
                            Give your AI a memory that <em>ages like yours.</em>
                        </h2>
                    </Reveal>
                    <Reveal delay={0.16}>
                        <p className="ml-cta-sub">
                            Free to start, honest about forgetting, and built so retrieval never charges you
                            twice.
                        </p>
                    </Reveal>
                    <Reveal delay={0.24}>
                        <div className="ml-cta-actions">
                            {authed ? (
                                <>
                                    <Link to={ROUTES.dive} className="ml-btn ml-btn-primary ml-btn-lg">
                                        Enter the Dive
                                        <Icon name="dive" size={14} />
                                    </Link>
                                    <button
                                        type="button"
                                        className="ml-btn ml-btn-ghost ml-btn-lg"
                                        onClick={() => scrollToId("ml-demo")}
                                    >
                                        <Icon name="spark" size={14} />
                                        Launch sandbox
                                    </button>
                                </>
                            ) : (
                                <>
                                    <Link to={ROUTES.signup} className="ml-btn ml-btn-primary ml-btn-lg">
                                        Start free
                                        <Icon name="plus" size={14} />
                                    </Link>
                                    <Link to={ROUTES.login} className="ml-btn ml-btn-ghost ml-btn-lg">
                                        <Icon name="dive" size={14} />
                                        Sign in
                                    </Link>
                                </>
                            )}
                        </div>
                    </Reveal>
                </section>
            </main>
        </div>
    );
}