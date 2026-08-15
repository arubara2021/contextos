import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useAuthContext } from "../../../auth/AuthProvider";
import { ROUTES } from "../../../constants";
import { Icon } from "../../shared/Icon";
import { HeroGraph } from "../HeroGraph";
import { CountUp, Reveal, ScrambleText, scrollToId } from "./fx";

const TITLE: Array<{ t: string; accent?: boolean }> = [
    { t: "A second brain that" },
    { t: "remembers", accent: true },
    { t: "and stays honest about" },
    { t: "forgetting.", accent: true },
];

export function MobileHero() {
    const { isAuthenticated, initializing } = useAuthContext();
    const authed = isAuthenticated && !initializing;
    return (
        <section className="ml-hero" id="ml-top">
            <span className="ml-hero-graph" aria-hidden="true">
                <HeroGraph />
            </span>
            <span className="ml-hero-veil" aria-hidden="true" />
            <div className="ml-hero-content">
                <Reveal>
                    <p className="ml-kicker">
                        <span className="ml-kicker-dot fx-pulse-soft" />
                        <ScrambleText text="Persistent memory for AI" />
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
                <Reveal delay={0.16} variant="fade">
                    <p className="ml-sub">
                        ContextOS distills every document and conversation into a{" "}
                        <strong>living knowledge graph</strong>, exactly once. From then on,{" "}
                        <strong>retrieval costs nothing</strong>, and each memory cools with neglect and{" "}
                        <em>reignites with use</em>.
                    </p>
                </Reveal>
                <Reveal delay={0.24} variant="scale">
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
                <Reveal delay={0.32} variant="left">
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
    );
}