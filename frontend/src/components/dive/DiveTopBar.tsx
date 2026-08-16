import { Icon } from "../shared/Icon";
import { ModelSelector } from "./ModelSelector";
import type { ModelInfo } from "../../types";

interface DiveTopBarProps {
    historyOpen: boolean;
    onToggleHistory: () => void;
    sessionTitle: string;
    stripOpen: boolean;
    onToggleStrip: () => void;
    models: ModelInfo[];
    activeKey: string | undefined;
    defaultKey: string | undefined;
    offline: boolean;
    loading: boolean;
    onSelectModel: (key: string) => void;
}

export function DiveTopBar({
    historyOpen,
    onToggleHistory,
    sessionTitle,
    stripOpen,
    onToggleStrip,
    models,
    activeKey,
    defaultKey,
    offline,
    loading,
    onSelectModel,
}: DiveTopBarProps) {
    return (
        <header className="dive-top">
            <div className="dive-top-left">
                <button
                    className={`dive-icon-btn ${historyOpen ? "is-active" : ""}`}
                    onClick={onToggleHistory}
                    aria-label={historyOpen ? "Hide conversations" : "Show conversations"}
                    aria-expanded={historyOpen}
                    title="Conversations"
                >
                    <Icon name="panel" size={18} />
                </button>
            </div>
            <div className="dive-session">
                <span className="dive-session-kicker">Dive</span>
                <span className="dive-session-title">{sessionTitle}</span>
            </div>
            <div className="dive-top-right">
                <ModelSelector
                    models={models}
                    activeKey={activeKey}
                    defaultKey={defaultKey}
                    offline={offline}
                    loading={loading}
                    onSelect={onSelectModel}
                />
                <button
                    className={`dive-icon-btn ${stripOpen ? "is-active" : ""}`}
                    onClick={onToggleStrip}
                    aria-label="Active context"
                    aria-expanded={stripOpen}
                    title="Active context"
                >
                    <Icon name="graph" size={18} />
                </button>
            </div>
        </header>
    );
}