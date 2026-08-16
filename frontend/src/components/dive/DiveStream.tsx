import type { ReactNode, Ref } from "react";
import { Icon } from "../shared/Icon";
import { MessageBubble } from "./MessageBubble";
import { MindReaching } from "./MindReaching";
import { MemoryTrace } from "./MemoryTrace";
import { formatMs } from "../../utils/format";
import type {
    ChatMessage,
    ChatResponse,
    InjectedMemory,
    QueryAnalysis,
} from "../../types";

interface DiveStreamProps {
    streamRef: Ref<HTMLDivElement>;
    messages: ChatMessage[];
    reaching: boolean;
    loadingHistory: boolean;
    trace: InjectedMemory[];
    analysis: QueryAnalysis | null;
    stats: ChatResponse["processingStats"] | null;
    onInspect: (bucketId: string) => void;
    children?: ReactNode;
}

export function DiveStream({
    streamRef,
    messages,
    reaching,
    loadingHistory,
    trace,
    analysis,
    stats,
    onInspect,
    children,
}: DiveStreamProps) {
    const lastMessage = messages[messages.length - 1];
    const showTrace =
        !reaching && trace.length > 0 && lastMessage?.role === "assistant";
    return (
        <div className="dive-stream" ref={streamRef}>
            <div className="dive-column">
                {loadingHistory && messages.length === 0 && (
                    <div className="msg">
                        <div className="msg-avatar">
                            <Icon name="spark" size={16} />
                        </div>
                        <div className="msg-body">
                            <div className="msg-meta">
                                <span className="ai-name">ContextOS</span>
                                <span>recalling</span>
                            </div>
                            <div className="md-recall" aria-live="polite">
                                <span className="md-recall-dots">
                                    <i />
                                    <i />
                                    <i />
                                </span>
                                <span className="md-recall-text">
                                    pulling this dive back from the archive
                                </span>
                            </div>
                        </div>
                    </div>
                )}
                {children}
                {messages.map((message) => (
                    <MessageBubble key={message.messageId} message={message} />
                ))}
                {reaching && <MindReaching />}
                {showTrace && (
                    <div className="dive-trace fx-rise">
                        {analysis && (
                            <div className="dive-trace-head">
                                <span className="dive-trace-intent">
                                    intent · {analysis.intent.replace(/_/g, " ")}
                                </span>
                                <span className="dive-trace-sep" />
                                {analysis.keyTerms.slice(0, 4).map((term) => (
                                    <span key={term} className="dive-trace-term">
                                        {term}
                                    </span>
                                ))}
                            </div>
                        )}
                        {stats && (
                            <p className="dive-trace-stats">
                                retrieved {trace.length} ·{" "}
                                {formatMs(stats.context.retrievalTimeMs)} retrieval ·{" "}
                                {formatMs(stats.totalDurationMs)} total
                            </p>
                        )}
                        <MemoryTrace memories={trace} onInspect={onInspect} />
                    </div>
                )}
            </div>
        </div>
    );
}