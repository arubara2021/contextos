import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Icon, type IconName } from "../components/shared/Icon";
import { MessageBubble } from "../components/dive/MessageBubble";
import { MindReaching } from "../components/dive/MindReaching";
import { MemoryTrace } from "../components/dive/MemoryTrace";
import { ContextStrip } from "../components/dive/ContextStrip";
import { SessionList } from "../components/dive/SessionList";
import { MessageInput } from "../components/dive/MessageInput";
import { ModelSelector } from "../components/dive/ModelSelector";
import { useAuthContext } from "../auth/AuthProvider";
import { useChat } from "../hooks/useChat";
import { useSessions } from "../hooks/useSessions";
import { useSettings } from "../hooks/useSettings";
import { useCortexBridge } from "../hooks/useCortexBridge";
import { api } from "../api";
import { FORGETTING_BUDGET_MAX, ROUTES } from "../constants";
import { formatMs } from "../utils/format";
import type { KnowledgeBaseState } from "../types";

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

const DESKTOP_QUERY = "(min-width: 1024px)";

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(DESKTOP_QUERY).matches : true
  );
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setIsDesktop(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return isDesktop;
}

function makeTitle(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 50) return cleaned;
  const truncated = cleaned.substring(0, 47);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated}...`;
}

function greetingForHour(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstName(displayName?: string): string | null {
  if (!displayName) return null;
  const first = displayName.trim().split(/\s+/)[0];
  return first.length > 0 ? first : null;
}

function AmbientField() {
  const dust = useMemo(
    () =>
      Array.from({ length: 10 }, () => ({
        left: `${Math.random() * 100}%`,
        top: `${30 + Math.random() * 70}%`,
        duration: `${10 + Math.random() * 14}s`,
        delay: `${-Math.random() * 12}s`,
        driftX: `${Math.round(Math.random() * 70 - 35)}px`,
        scale: 0.5 + Math.random() * 0.8,
      })),
    []
  );
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
        <path d="M-50 620 C 250 520, 420 700, 700 580 S 1100 480, 1260 560" stroke="rgba(255, 138, 61, 0.10)" strokeWidth="1.4" fill="none" />
        <path className="fx-dash" d="M-40 200 C 260 300, 520 140, 820 240 S 1150 320, 1250 240" stroke="rgba(143, 216, 210, 0.10)" strokeWidth="1.2" fill="none" strokeDasharray="6 10" />
        <path d="M180 -40 C 240 220, 120 420, 260 700" stroke="rgba(236, 229, 218, 0.05)" strokeWidth="1.2" fill="none" />
        <path className="fx-dash" d="M-30 430 C 300 380, 620 480, 900 400 S 1180 350, 1240 390" stroke="rgba(255, 138, 61, 0.06)" strokeWidth="1.1" fill="none" strokeDasharray="4 12" />
        <circle className="fx-breathe" cx="700" cy="580" r="3" fill="rgba(255, 177, 92, 0.5)" />
        <circle className="fx-breathe" cx="820" cy="240" r="2.4" fill="rgba(143, 216, 210, 0.45)" style={{ animationDelay: "1.2s" }} />
        <circle className="fx-breathe" cx="260" cy="700" r="2" fill="rgba(236, 229, 218, 0.3)" style={{ animationDelay: "2.1s" }} />
        <circle className="fx-breathe" cx="900" cy="400" r="2.2" fill="rgba(255, 138, 61, 0.4)" style={{ animationDelay: "3s" }} />
      </svg>
      {dust.map((spec, i) => (
        <span
          key={i}
          className="dust"
          style={
            {
              left: spec.left,
              top: spec.top,
              transform: `scale(${spec.scale})`,
              "--drift-dur": spec.duration,
              "--drift-delay": spec.delay,
              "--drift-x": spec.driftX,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function SuggestionCard({
  suggestion,
  index,
  onPick,
}: {
  suggestion: Suggestion;
  index: number;
  onPick: (text: string) => void;
}) {
  return (
    <button
      onClick={() => onPick(suggestion.text)}
      className="dive-suggest fx-rise"
      style={{ "--rise-delay": `${0.12 + index * 0.07}s` } as CSSProperties}
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
  );
}

function ArchiveCta({ kicker, label }: { kicker: string; label: string }) {
  return (
    <Link to={ROUTES.archive} className="dive-archive-cta">
      <span className="dive-archive-icon">
        <Icon name="upload" size={15} />
      </span>
      <span className="dive-archive-body">
        <span className="dive-archive-kicker">{kicker}</span>
        <span className="dive-archive-label">{label}</span>
      </span>
      <Icon name="chevron" size={13} className="dive-suggest-chev" />
    </Link>
  );
}

function ResumePill({ title, onPick }: { title: string; onPick: () => void }) {
  return (
    <button onClick={onPick} className="dive-resume">
      <Icon name="history" size={13} className="dive-resume-icon" />
      <span className="dive-resume-kicker">resume</span>
      <span className="dive-resume-title">{title}</span>
    </button>
  );
}

export function DivePage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const bridge = useCortexBridge();
  const isDesktop = useIsDesktop();
  const { user } = useAuthContext();
  const { sessions, select, create, rename, remove, refetch } = useSessions();
  const { settings, loading: settingsLoading, error: settingsError } = useSettings();
  const [stripOpen, setStripOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(DESKTOP_QUERY).matches : false
  );
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [kbState, setKbState] = useState<KnowledgeBaseState | null>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const pendingTitleRef = useRef<string | null>(null);

  const models = settings?.models.available ?? [];
  const defaultKey = settings?.models.default;

  const handleSessionCreated = useCallback(
    async (id: string) => {
      select(id);
      navigate(`${ROUTES.dive}/${id}`, { replace: true });
      await refetch();
      const title = pendingTitleRef.current;
      if (title) {
        pendingTitleRef.current = null;
        await rename(id, title);
      }
    },
    [navigate, select, refetch, rename]
  );

  const {
    messages,
    reaching,
    trace,
    available,
    analysis,
    stats,
    knowledgeBase,
    loadingHistory,
    error,
    send,
    clearError,
  } = useChat({
    initialSessionId: sessionId ?? null,
    onSessionCreated: handleSessionCreated,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([api.memories.stats(), api.documents.list()]).then(
      ([statsResult, docsResult]) => {
        if (cancelled) return;
        if (statsResult.status === "rejected" && docsResult.status === "rejected") return;
        const memoryCount = statsResult.status === "fulfilled" ? statsResult.value.totalBuckets : 0;
        const documentCount = docsResult.status === "fulfilled" ? docsResult.value.count : 0;
        setKbState({ memoryCount, documentCount, hasKnowledge: memoryCount > 0 });
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    const coarse = window.matchMedia("(pointer: coarse)");
    const apply = () => {
      if (viewport) {
        root.style.setProperty("--vv-top", `${Math.round(viewport.offsetTop)}px`);
        root.style.setProperty("--vv-h", `${Math.round(viewport.height)}px`);
      }
      const deltaOpen = viewport ? window.innerHeight - viewport.height > 160 : false;
      const ratioOpen =
        coarse.matches &&
        window.screen.height > 0 &&
        (viewport
          ? viewport.height < window.screen.height * 0.72
          : window.innerHeight < window.screen.height * 0.72);
      root.classList.toggle("kb-open", deltaOpen || ratioOpen);
    };
    apply();
    if (viewport) {
      viewport.addEventListener("resize", apply);
      viewport.addEventListener("scroll", apply);
    }
    window.addEventListener("resize", apply);
    return () => {
      if (viewport) {
        viewport.removeEventListener("resize", apply);
        viewport.removeEventListener("scroll", apply);
      }
      window.removeEventListener("resize", apply);
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-h");
      root.classList.remove("kb-open");
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      )
        return;
      if (stripOpen) {
        setStripOpen(false);
        return;
      }
      if (historyOpen) setHistoryOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stripOpen, historyOpen]);

  useEffect(() => {
    const element = streamRef.current;
    if (!element) return;
    if (messages.length === 0 && !reaching) {
      element.scrollTop = 0;
      return;
    }
    element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messages, reaching, loadingHistory]);

  const handleSend = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const currentTitle = sessions.find((s) => s.sessionId === sessionId)?.title;
      const needsTitle = !currentTitle || currentTitle === "New conversation";
      if (needsTitle && messages.length === 0) {
        const title = makeTitle(trimmed);
        if (sessionId) {
          void rename(sessionId, title);
        } else {
          pendingTitleRef.current = title;
        }
      }
      void send(text, modelId);
    },
    [send, modelId, sessionId, sessions, messages.length, rename]
  );

  const handleInspect = useCallback(
    (bucketId: string) => {
      bridge.focus(bucketId);
      setStripOpen(true);
    },
    [bridge]
  );

  const handleSelectSession = (id: string) => {
    select(id);
    if (!isDesktop) setHistoryOpen(false);
    navigate(`${ROUTES.dive}/${id}`);
  };

  const handleNewSession = async () => {
    const session = await create();
    if (!isDesktop) setHistoryOpen(false);
    navigate(`${ROUTES.dive}/${session.sessionId}`);
  };

  const activeSession = sessions.find((s) => s.sessionId === sessionId);
  const lastMessage = messages[messages.length - 1];
  const showTrace = !reaching && trace.length > 0 && lastMessage?.role === "assistant";
  const isEmpty = messages.length === 0 && !reaching && !loadingHistory;
  const greet = greetingForHour();
  const name = firstName(user?.displayName);
  const resumeTarget = sessions.find((s) => s.sessionId !== sessionId && s.messageCount > 0);
  const kb = knowledgeBase ?? kbState;
  const memoryCount = kb?.memoryCount ?? 0;
  const documentCount = kb?.documentCount ?? 0;
  const archiveIsEmpty = kb !== null && memoryCount === 0 && documentCount === 0;
  const archiveDistilling = kb !== null && memoryCount === 0 && documentCount > 0;

  return (
    <div className={`dive${historyOpen || stripOpen ? " dive--overlay" : ""}`}>
      <div className="dive-aura" aria-hidden="true" />
      <AmbientField />
      <div
        className={`dive-shell ${historyOpen ? "is-open" : "is-closed"}`}
        style={{ paddingLeft: isDesktop ? 72 : 0 }}
      >
        {!isDesktop && (
          <div className={`dive-veil ${historyOpen ? "open" : ""}`} onClick={() => setHistoryOpen(false)} />
        )}
        <SessionList
          inline={isDesktop}
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          sessions={sessions}
          activeSessionId={sessionId ?? null}
          onSelect={handleSelectSession}
          onCreate={handleNewSession}
          onDelete={remove}
          onRename={rename}
        />
        <div className="dive-main">
          <header className="dive-top">
            <div className="dive-top-left">
              <button
                className={`dive-icon-btn ${historyOpen ? "is-active" : ""}`}
                onClick={() => setHistoryOpen((v) => !v)}
                aria-label={historyOpen ? "Hide conversations" : "Show conversations"}
                aria-expanded={historyOpen}
                title="Conversations"
              >
                <Icon name="panel" size={18} />
              </button>
            </div>
            <div className="dive-session">
              <span className="dive-session-kicker">Dive</span>
              <span className="dive-session-title">{activeSession?.title ?? "New conversation"}</span>
            </div>
            <div className="dive-top-right">
              <ModelSelector
                models={models}
                activeKey={modelId}
                defaultKey={defaultKey}
                offline={Boolean(settingsError)}
                loading={settingsLoading}
                onSelect={setModelId}
              />
              <button
                className={`dive-icon-btn ${stripOpen ? "is-active" : ""}`}
                onClick={() => setStripOpen((v) => !v)}
                aria-label="Active context"
                aria-expanded={stripOpen}
                title="Active context"
              >
                <Icon name="graph" size={18} />
              </button>
            </div>
          </header>
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
                      <span className="md-recall-text">pulling this dive back from the archive</span>
                    </div>
                  </div>
                </div>
              )}
              {isEmpty && (
                <div className="dive-empty fx-rise">
                  <p className="dive-empty-kicker">
                    <span className="dive-empty-dot fx-breathe" />
                    the dive · memory-injected chat
                  </p>
                  <p className="dive-greet">
                    {greet}
                    {name ? `, ${name}` : ""}.
                  </p>
                  {archiveIsEmpty ? (
                    <>
                      <h1 className="dive-empty-title">
                        Nothing remembered <em>yet.</em>
                      </h1>
                      <p className="dive-empty-sub">
                        Your archive is empty — I hold nothing of yours to recall. Feed me your
                        first document and it is distilled once into memories every future
                        question can reach.
                      </p>
                      <ArchiveCta kicker="feed the archive" label="Upload your first document" />
                      <p className="dive-empty-note">meanwhile — general knowledge needs no feeding</p>
                      <div className="dive-suggest-grid">
                        {EMPTY_ARCHIVE_SUGGESTIONS.map((suggestion, i) => (
                          <SuggestionCard key={suggestion.text} suggestion={suggestion} index={i} onPick={handleSend} />
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
                      <ArchiveCta kicker="watch it distill" label="Open the Archive" />
                      {resumeTarget && (
                        <ResumePill title={resumeTarget.title} onPick={() => handleSelectSession(resumeTarget.sessionId)} />
                      )}
                    </>
                  ) : (
                    <>
                      <h1 className="dive-empty-title">
                        What shall we <em>remember?</em>
                      </h1>
                      <p className="dive-empty-sub">
                        Every question sweeps vector, text, and graph in parallel. The memories
                        that answer ignite into the trace before the reply forms.
                      </p>
                      {resumeTarget && (
                        <ResumePill title={resumeTarget.title} onPick={() => handleSelectSession(resumeTarget.sessionId)} />
                      )}
                      <div className="dive-suggest-grid">
                        {SUGGESTIONS.map((suggestion, i) => (
                          <SuggestionCard key={suggestion.text} suggestion={suggestion} index={i} onPick={handleSend} />
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
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
                      retrieved {trace.length} · {formatMs(stats.context.retrievalTimeMs)} retrieval ·{" "}
                      {formatMs(stats.totalDurationMs)} total
                    </p>
                  )}
                  <MemoryTrace memories={trace} onInspect={handleInspect} />
                </div>
              )}
            </div>
          </div>
          <div className="dive-composer">
            {error && (
              <div role="alert" className="dive-error fx-rise">
                <span className="dive-error-icon">
                  <Icon name="close" size={11} />
                </span>
                <p className="dive-error-text">{error}</p>
                <button onClick={clearError} className="dive-error-dismiss">
                  dismiss
                </button>
              </div>
            )}
            <MessageInput onSend={handleSend} disabled={reaching} />
            <div className="composer-hints">
              <span>memories auto-inject</span>
              <span>esc dismisses panels</span>
              <span className="count">
                budget {stats?.context.budgetUsed ?? 0}/{stats?.context.budgetMax ?? FORGETTING_BUDGET_MAX}
              </span>
            </div>
          </div>
        </div>
      </div>
      <ContextStrip
        open={stripOpen}
        onClose={() => setStripOpen(false)}
        injected={trace}
        available={available}
        budgetUsed={stats?.context.budgetUsed ?? trace.length}
        budgetMax={stats?.context.budgetMax ?? FORGETTING_BUDGET_MAX}
      />
    </div>
  );
}