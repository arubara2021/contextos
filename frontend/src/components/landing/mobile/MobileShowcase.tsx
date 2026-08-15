import { Icon } from "../../shared/Icon";
import { DecayDemo } from "../DecayDemo";
import { Reveal, ScrambleText } from "./fx";

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

export function MobileShowcase() {
    return (
        <>
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
                        <p className="ml-kicker">
                            <span className="ml-kicker-idx">01</span>
                            <ScrambleText text="The memory model" />
                        </p>
                    </Reveal>
                    <Reveal delay={0.08}>
                        <h2 className="ml-section-title">
                            Strength is <em>temperature.</em>
                        </h2>
                    </Reveal>
                    <Reveal delay={0.16} variant="fade">
                        <p className="ml-section-sub">
                            One instrument, not four boxes. Pick a memory on the rail, read its live decay
                            curve on the stage, and watch the dial cool until you reach for it again.
                        </p>
                    </Reveal>
                </div>
                <Reveal delay={0.1} variant="scale">
                    <div className="ml-decay-wrap">
                        <DecayDemo />
                    </div>
                </Reveal>
            </section>
            <section className="ml-section" id="ml-how">
                <div className="ml-section-head ml-section-head-left">
                    <Reveal>
                        <p className="ml-kicker">
                            <span className="ml-kicker-idx">02</span>
                            <ScrambleText text="The pipeline" />
                        </p>
                    </Reveal>
                    <Reveal delay={0.08}>
                        <h2 className="ml-section-title">
                            One pass in. <em>Free</em> forever after.
                        </h2>
                    </Reveal>
                </div>
                <div className="ml-pipe-steps">
                    {PIPE.map((step, i) => (
                        <Reveal key={step.idx} delay={i * 0.08} variant={i % 2 === 0 ? "left" : "right"}>
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
                <Reveal delay={0.1} variant="fade">
                    <p className="ml-pipe-close">
                        <span className="ml-pipe-close-dot fx-flicker" />
                        And when you stop using a memory, it does not linger in silence. It cools, on
                        screen, until you choose to bring it back.
                    </p>
                </Reveal>
            </section>
        </>
    );
}