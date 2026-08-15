import { Link } from "react-router-dom";
import { useAuthContext } from "../../../auth/AuthProvider";
import { ROUTES } from "../../../constants";
import { Icon } from "../../shared/Icon";
import { DemoEntry } from "../DemoEntry";
import { Reveal, ScrambleText, Tilt, scrollToId } from "./fx";

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

export function MobileOutro() {
    const { isAuthenticated, initializing } = useAuthContext();
    const authed = isAuthenticated && !initializing;
    return (
        <>
            <section className="ml-section" id="ml-engine">
                <div className="ml-section-head">
                    <Reveal>
                        <p className="ml-kicker">
                            <span className="ml-kicker-idx">04</span>
                            <ScrambleText text="The engine" />
                        </p>
                    </Reveal>
                    <Reveal delay={0.08}>
                        <h2 className="ml-section-title">
                            The intelligence, <em>not</em> the plumbing.
                        </h2>
                    </Reveal>
                    <Reveal delay={0.16} variant="fade">
                        <p className="ml-section-sub">
                            Three ideas do the heavy lifting. Everything else is simply where they live.
                        </p>
                    </Reveal>
                </div>
                <div className="ml-engine-cards">
                    {ENGINE.map((card, i) => (
                        <Reveal key={card.idx} delay={i * 0.08} variant={i % 2 === 0 ? "left" : "right"}>
                            <Tilt max={4}>
                                <div className="ml-engine-card">
                                    <span className="ml-engine-num">{card.idx}</span>
                                    <h3 className="ml-engine-name">{card.title}</h3>
                                    <p className="ml-engine-body">{card.body}</p>
                                </div>
                            </Tilt>
                        </Reveal>
                    ))}
                </div>
                <Reveal delay={0.12} variant="fade">
                    <p className="ml-engine-substrate">
                        All of it runs on a single CockroachDB cluster. Amazon Bedrock supplies the
                        reasoning through Nova Pro and Nova Lite, and Amazon S3 seals the originals.
                    </p>
                </Reveal>
            </section>
            <section className="ml-section ml-demo-section" id="ml-demo">
                <Reveal variant="scale">
                    <DemoEntry />
                </Reveal>
            </section>
            <section className="ml-cta">
                <Reveal>
                    <p className="ml-kicker ml-kicker-center">
                        <ScrambleText text="Open the archive" />
                    </p>
                </Reveal>
                <Reveal delay={0.08}>
                    <h2 className="ml-cta-title">
                        Give your AI a memory that <em>ages like yours.</em>
                    </h2>
                </Reveal>
                <Reveal delay={0.16} variant="fade">
                    <p className="ml-cta-sub">
                        Free to start, honest about forgetting, and built so retrieval never charges you
                        twice.
                    </p>
                </Reveal>
                <Reveal delay={0.24} variant="scale">
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
        </>
    );
}