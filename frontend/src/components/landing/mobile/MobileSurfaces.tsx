import { useEffect, useState } from "react";
import { MiniGraph } from "../MiniGraph";
import {
    Reveal,
    ScrambleText,
    Tilt,
    Typed,
    useInView,
    usePrefersReducedMotion,
} from "./fx";

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
    const reduced = usePrefersReducedMotion();
    const [rootRef, inView] = useInView<HTMLDivElement>(0.15);
    const [si, setSi] = useState(0);
    const [stage, setStage] = useState<"q" | "sweep" | "a" | "hold">("q");
    useEffect(() => {
        if (!inView) return;
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
    }, [stage, inView]);
    const sc = DIVE_SCENARIOS[si];
    return (
        <div ref={rootRef} className="dive-live" aria-hidden="true">
            <div className="dl-top">
                <span className="dl-live-dot fx-breathe" />
                <span className="dl-label">live retrieval</span>
                <span className="dl-budget">
                    <span
                        className="dl-budget-fill"
                        style={{ width: `${(sc.budget / 20) * 100}%` }}
                    />
                </span>
                <span className="dl-budget-num">{sc.budget}/20</span>
            </div>
            <div className="dl-bubble dl-bubble-user">
                <span className="dl-role">you</span>
                <Typed
                    key={`q${si}`}
                    text={sc.q}
                    play={!reduced}
                    onDone={() => setStage("sweep")}
                />
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
                    <Typed
                        key={`a${si}`}
                        text={sc.a}
                        play={!reduced}
                        onDone={() => setStage("hold")}
                    />
                )}
            </div>
        </div>
    );
}

export function MobileSurfaces() {
    return (
        <section className="ml-section" id="ml-surfaces">
            <div className="ml-section-head">
                <Reveal>
                    <p className="ml-kicker">
                        <span className="ml-kicker-idx">03</span>
                        <ScrambleText text="Two surfaces, one engine" />
                    </p>
                </Reveal>
                <Reveal delay={0.08}>
                    <h2 className="ml-section-title">
                        Read it as a <em>place.</em> Talk to it as a <em>mind.</em>
                    </h2>
                </Reveal>
            </div>
            <div className="ml-surf-cards">
                <Reveal variant="left">
                    <Tilt>
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
                    </Tilt>
                </Reveal>
                <Reveal delay={0.12} variant="right">
                    <Tilt>
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
                    </Tilt>
                </Reveal>
            </div>
        </section>
    );
}