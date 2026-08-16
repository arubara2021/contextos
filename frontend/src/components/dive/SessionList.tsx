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
        <span className="dive-history-head-left">
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
      <div className="dive-history-cta-wrap">
        <button
          className="dive-history-cta"
          onClick={() => void onCreate()}
          aria-label="New conversation"
        >
          <Icon name="plus" size={13} />
          <span>new dive</span>
        </button>
      </div>
      <div className="dive-history-search-wrap">
        <div className="dive-history-search">
          <Icon name="search" size={13} className="dive-history-search-icon" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search dives"
            aria-label="Search conversations"
          />
          {query && (
            <button
              className="dive-history-search-clear"
              onClick={() => setQuery("")}
              aria-label="Clear search"
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      </div>
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
                    <div className="dive-history-confirm fx-rise">
                      <Icon name="trash" size={13} className="dive-history-confirm-icon" />
                      <span className="dive-history-confirm-title">{session.title}</span>
                      <button
                        className="dive-history-confirm-yes"
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
                        className="dive-history-confirm-no"
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
      <div className="dive-history-foot">
        <span className="dive-history-foot-dot" />
        <span>{sessions.length} dives · memories auto-extracted</span>
      </div>
    </>
  );

  if (inline) {
    return (
      <aside className="dive-history dive-history--inline">
        <div className="dive-history-inner">{body}</div>
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