import { useMemo, useState, type ReactNode } from "react";
import { Icon } from "../shared/Icon";
import type { Session } from "../../types";
import { daysSince, isToday, relativeTime } from "../../utils/date";

interface SessionListProps {
  inline: boolean;
  open: boolean;
  onClose: () => void;
  sessions: Session[];
  activeSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onCreate: () => void | Promise<void>;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
}

type GroupKey = "today" | "week" | "earlier";

const GROUP_ORDER: GroupKey[] = ["today", "week", "earlier"];

const GROUP_LABELS: Record<GroupKey, string> = {
  today: "today",
  week: "this week",
  earlier: "earlier",
};

function groupKeyFor(session: Session): GroupKey {
  const reference = session.lastMessageAt ?? session.createdAt;
  if (isToday(reference)) return "today";
  if (daysSince(reference) < 7) return "week";
  return "earlier";
}

export function SessionList({
  inline,
  open,
  onClose,
  sessions,
  activeSessionId,
  onSelect,
  onCreate,
  onDelete,
  onRename,
}: SessionListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (session) =>
        session.title.toLowerCase().includes(q) ||
        (session.lastMessage ?? "").toLowerCase().includes(q)
    );
  }, [sessions, query]);

  const groups = useMemo(() => {
    const buckets: Record<GroupKey, Session[]> = {
      today: [],
      week: [],
      earlier: [],
    };
    for (const session of filtered) {
      buckets[groupKeyFor(session)].push(session);
    }
    return GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
      key,
      items: buckets[key],
    }));
  }, [filtered]);

  const startRename = (session: Session) => {
    setConfirmId(null);
    setMenuId(null);
    setEditingId(session.sessionId);
    setDraftTitle(session.title);
  };

  const commitRename = () => {
    if (editingId && draftTitle.trim()) {
      onRename(editingId, draftTitle.trim());
    }
    setEditingId(null);
  };

  const body: ReactNode = (
    <>
      <div className="dive-history-head">
        <span className="flex min-w-0 items-center gap-2">
          <span className="dive-history-kicker">Conversations</span>
          <span className="dive-history-count">{sessions.length}</span>
        </span>
        <button
          className="dive-history-icon"
          onClick={onClose}
          aria-label={inline ? "Collapse conversations" : "Close conversations"}
          title={inline ? "Collapse" : "Close"}
        >
          <Icon name={inline ? "panel" : "close"} size={15} />
        </button>
      </div>
      <div className="px-3 pb-3">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(145deg,var(--ember-hi),var(--ember-deep))] px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-[#2a1708] shadow-ember transition-all duration-200 hover:-translate-y-px hover:brightness-106 active:scale-[0.97]"
          onClick={() => void onCreate()}
          aria-label="New conversation"
        >
          <Icon name="plus" size={13} />
          <span>new dive</span>
        </button>
      </div>
      {sessions.length >= 8 && (
        <div className="px-3 pb-2.5">
          <div className="flex items-center gap-2.5 rounded-xl border border-line bg-[rgb(14_11_9/0.55)] px-3 py-2 transition-colors duration-200 focus-within:border-[rgb(255_138_61/0.35)]">
            <Icon name="search" size={13} className="flex-none text-stone" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search dives"
              aria-label="Search conversations"
              className="w-full bg-transparent text-[12.5px] font-light text-bone outline-none placeholder:text-[color:var(--faint)]"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="flex-none text-stone transition-colors duration-150 hover:text-bone"
              >
                <Icon name="close" size={12} />
              </button>
            )}
          </div>
        </div>
      )}
      <div className="dive-history-list">
        {sessions.length === 0 && (
          <div className="dive-history-empty">
            <span className="empty-glyph">
              <Icon name="dive" size={24} />
            </span>
            <p>No dives yet. Every conversation becomes extractable memory.</p>
          </div>
        )}
        {sessions.length > 0 && filtered.length === 0 && (
          <div className="dive-history-empty">
            <span className="empty-glyph">
              <Icon name="search" size={22} />
            </span>
            <p>No dives match “{query}”.</p>
          </div>
        )}
        {groups.map((group) => (
          <div key={group.key}>
            <div className="dive-history-group">
              <span>{GROUP_LABELS[group.key]}</span>
              <span className="dive-history-group-line" />
            </div>
            {group.items.map((session) => {
              const active = session.sessionId === activeSessionId;
              const editing = editingId === session.sessionId;
              const confirming = confirmId === session.sessionId;
              const menuOpen = menuId === session.sessionId;
              return (
                <div className="dive-history-item" key={session.sessionId}>
                  {confirming ? (
                    <div className="fx-rise flex items-center gap-2.5 rounded-[14px] border border-flare/40 bg-[rgb(255_92_73/0.08)] px-3 py-2.5">
                      <Icon name="trash" size={13} className="flex-none text-flare" />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-light text-bone/90">
                        {session.title}
                      </span>
                      <button
                        className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-flare/40 text-flare transition-all duration-150 hover:bg-flare/15 active:scale-90"
                        onClick={() => {
                          setConfirmId(null);
                          onDelete(session.sessionId);
                        }}
                        aria-label="Confirm delete"
                        title="Delete forever"
                      >
                        <Icon name="check" size={13} />
                      </button>
                      <button
                        className="grid h-8 w-8 flex-none place-items-center rounded-lg border border-line-strong text-stone transition-all duration-150 hover:bg-soot hover:text-bone active:scale-90"
                        onClick={() => setConfirmId(null)}
                        aria-label="Cancel delete"
                        title="Keep it"
                      >
                        <Icon name="close" size={13} />
                      </button>
                    </div>
                  ) : editing ? (
                    <input
                      autoFocus
                      className="dive-history-rename"
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") commitRename();
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      onBlur={commitRename}
                      aria-label="Rename conversation"
                    />
                  ) : (
                    <>
                      <button
                        className={`dive-history-row${active ? " is-active" : ""}`}
                        onClick={() => {
                          setMenuId(null);
                          onSelect(session.sessionId);
                        }}
                      >
                        <span className="dive-history-title">{session.title}</span>
                        {session.lastMessage && (
                          <span className="dive-history-preview">
                            {session.lastMessage}
                          </span>
                        )}
                        <span className="dive-history-meta">
                          {session.messageCount} msgs ·{" "}
                          {relativeTime(session.lastMessageAt ?? session.createdAt)}
                        </span>
                      </button>
                      <button
                        className={`dive-history-more${menuOpen ? " is-open" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuId((current) =>
                            current === session.sessionId ? null : session.sessionId
                          );
                        }}
                        aria-label="Session actions"
                        aria-expanded={menuOpen}
                        title="Actions"
                      >
                        <i />
                        <i />
                        <i />
                      </button>
                      {menuOpen && (
                        <div className="dive-history-menu fx-rise">
                          <button
                            onClick={() => {
                              setMenuId(null);
                              startRename(session);
                            }}
                          >
                            <Icon name="edit" size={12} />
                            <span>rename</span>
                          </button>
                          <button
                            className="danger"
                            onClick={() => {
                              setMenuId(null);
                              setConfirmId(session.sessionId);
                            }}
                          >
                            <Icon name="trash" size={12} />
                            <span>delete</span>
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="dive-history-foot flex items-center gap-2">
        <span className="h-1.5 w-1.5 flex-none rounded-full bg-ember shadow-ember" />
        <span>{sessions.length} dives · memories auto-extracted</span>
      </div>
    </>
  );

  if (inline) {
    return (
      <aside
        className={[
          "relative flex-none overflow-hidden border-r bg-[linear-gradient(180deg,#14100d_0%,#0f0c0a_100%)] transition-[width,opacity,border-color] duration-300 ease-out",
          open
            ? "w-[300px] border-line opacity-100"
            : "w-0 border-transparent opacity-0",
        ].join(" ")}
      >
        <div className="flex h-full min-h-0 w-[300px] flex-col">{body}</div>
      </aside>
    );
  }

  return (
    <aside
      className={`dive-history dive-history--drawer${open ? " open" : ""}`}
      aria-hidden={!open}
    >
      {body}
    </aside>
  );
}