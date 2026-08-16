import { Link } from "react-router-dom";
import { Icon, type IconName } from "../shared/Icon";
import { ROUTES } from "../../constants";

interface Suggestion {
    kicker: string;
    icon: IconName;
    text: string;
}

const SUGGESTIONS: Suggestion[] = [
    { kicker: "recall", icon: "history", text: "What have I learned about this project?" },
    { kicker: "synthesize", icon: "layers", text: "Summarize my recent documents" },
    { kicker: "decay", icon: "spark", text: "What's fading from my memory?" },
    { kicker: "connect", icon: "cortex", text: "Connect the dots between my notes" },
];

const EMPTY_ARCHIVE_SUGGESTIONS: Suggestion[] = [
    { kicker: "orient", icon: "spark", text: "What can you do?" },
    { kicker: "learn", icon: "layers", text: "How does memory decay work?" },
];

function greetingForHour(): string {
    const hour = new Date().getHours();
    if (hour < 5) return "Still up";
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
}

interface DiveEmptyStateProps {
    userName: string | null;
    archiveIsEmpty: boolean;
    archiveDistilling: boolean;
    documentCount: number;
    resumeTitle: string | null;
    onResume: () => void;
    onPick: (text: string) => void;
}

export function DiveEmptyState({
    userName,
    archiveIsEmpty,
    archiveDistilling,
    documentCount,
    resumeTitle,
    onResume,
    onPick,
}: DiveEmptyStateProps) {
    const greet = greetingForHour();
    return (
        <div className="dive-empty fx-rise">
            <p className="dive-empty-kicker">
                <span className="dive-empty-dot fx-breathe" />
                the dive · memory-injected chat
            </p>
            <p className="dive-greet">
                {greet}
                {userName ? `, ${userName}` : ""}.
            </p>
            {archiveIsEmpty ? (
                <>
                    <h1 className="dive-empty-title">
                        Nothing remembered <em>yet.</em>
                    </h1>
                    <p className="dive-empty-sub">
                        Your archive is empty — I hold nothing of yours to recall. Feed me
                        your first document and it is distilled once into memories every
                        future question can reach.
                    </p>
                    <Link to={ROUTES.archive} className="dive-archive-cta">
                        <span className="dive-archive-icon">
                            <Icon name="upload" size={15} />
                        </span>
                        <span className="dive-archive-body">
                            <span className="dive-archive-kicker">feed the archive</span>
                            <span className="dive-archive-label">Upload your first document</span>
                        </span>
                        <Icon name="chevron" size={13} className="dive-suggest-chev" />
                    </Link>
                    <p className="dive-empty-note">meanwhile — general knowledge needs no feeding</p>
                    <div className="dive-suggest-grid">
                        {EMPTY_ARCHIVE_SUGGESTIONS.map((suggestion) => (
                            <button
                                key={suggestion.text}
                                className="dive-suggest"
                                onClick={() => onPick(suggestion.text)}
                            >
                                <span className="dive-suggest-icon">
                                    <Icon name={suggestion.icon} size={16} />
                                </span>
                                <span className="dive-suggest-body">
                                    <span className="dive-suggest-kicker">{suggestion.kicker}</span>
                                    <span className="dive-suggest-text">{suggestion.text}</span>
                                </span>
                                <Icon name="chevron" size={13} className="dive-suggest-chev" />
                            </button>
                        ))}
                    </div>
                </>
            ) : archiveDistilling ? (
                <>
                    <h1 className="dive-empty-title">
                        Distilling in <em>motion.</em>
                    </h1>
                    <p className="dive-empty-sub">
                        {documentCount === 1
                            ? "Your document is still being distilled into memories."
                            : `${documentCount} documents are still being distilled into memories.`}{" "}
                        The first traces ignite the moment extraction finishes.
                    </p>
                    <Link to={ROUTES.archive} className="dive-archive-cta">
                        <span className="dive-archive-icon">
                            <Icon name="spark" size={15} />
                        </span>
                        <span className="dive-archive-body">
                            <span className="dive-archive-kicker">watch it distill</span>
                            <span className="dive-archive-label">Open the Archive</span>
                        </span>
                        <Icon name="chevron" size={13} className="dive-suggest-chev" />
                    </Link>
                    {resumeTitle && (
                        <button className="dive-resume" onClick={onResume}>
                            <Icon name="history" size={13} className="dive-resume-icon" />
                            <span className="dive-resume-kicker">resume</span>
                            <span className="dive-resume-title">{resumeTitle}</span>
                        </button>
                    )}
                </>
            ) : (
                <>
                    <h1 className="dive-empty-title">
                        What shall we <em>remember?</em>
                    </h1>
                    <p className="dive-empty-sub">
                        Every question sweeps vector, text, and graph in parallel. The
                        memories that answer ignite into the trace before the reply forms.
                    </p>
                    {resumeTitle && (
                        <button className="dive-resume" onClick={onResume}>
                            <Icon name="history" size={13} className="dive-resume-icon" />
                            <span className="dive-resume-kicker">resume</span>
                            <span className="dive-resume-title">{resumeTitle}</span>
                        </button>
                    )}
                    <div className="dive-suggest-grid">
                        {SUGGESTIONS.map((suggestion) => (
                            <button
                                key={suggestion.text}
                                className="dive-suggest"
                                onClick={() => onPick(suggestion.text)}
                            >
                                <span className="dive-suggest-icon">
                                    <Icon name={suggestion.icon} size={16} />
                                </span>
                                <span className="dive-suggest-body">
                                    <span className="dive-suggest-kicker">{suggestion.kicker}</span>
                                    <span className="dive-suggest-text">{suggestion.text}</span>
                                </span>
                                <Icon name="chevron" size={13} className="dive-suggest-chev" />
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}