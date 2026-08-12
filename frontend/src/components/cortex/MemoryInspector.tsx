import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { useMemoryDetail } from "../../hooks/useMemoryDetail";
import { useReminders } from "../../hooks/useReminders";
import { useCortexBridge } from "../../hooks/useCortexBridge";
import { DecayCurveChart } from "./DecayCurveChart";
import { Icon } from "../shared/Icon";
import {
  CONCEPT_TYPES,
  CONCEPT_TYPE_ORDER,
  RELATIONSHIP_TYPES,
} from "../../constants";
import type { ConceptType } from "../../types";
import { formatDay } from "../../utils/date";

interface MemoryInspectorProps {
  bucketId: string | null;
  onClose: () => void;
  onReignited: (bucketId: string) => void;
}

const DISMISS_DISTANCE = 120;
const VELOCITY_DISMISS = 0.6;

export function MemoryInspector({
  bucketId,
  onClose,
  onReignited,
}: MemoryInspectorProps) {
  const open = bucketId !== null;
  const { detail, loading, refetch } = useMemoryDetail(bucketId);
  const bridge = useCortexBridge();
  const { reminders, boost, check } = useReminders();
  const [editing, setEditing] = useState(false);
  const [editCanonical, setEditCanonical] = useState("");
  const [editImportance, setEditImportance] = useState(5);
  const [editType, setEditType] = useState<ConceptType>("fact");
  const [reigniting, setReigniting] = useState(false);
  const [saving, setSaving] = useState(false);
  const lastDetailRef = useRef(detail);
  if (detail) lastDetailRef.current = detail;
  const shown = detail ?? lastDetailRef.current;

  const sheetRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const startYRef = useRef(0);
  const currentYRef = useRef(0);
  const lastYRef = useRef(0);
  const lastTimeRef = useRef(0);
  const velocityRef = useRef(0);
  const canDragRef = useRef(false);

  useEffect(() => {
    if (!detail) return;
    setEditCanonical(detail.bucket.canonical);
    setEditImportance(detail.bucket.importance);
    setEditType(detail.bucket.conceptType);
    setEditing(false);
  }, [detail]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const setSheetPosition = (y: number, animate: boolean) => {
    const sheet = sheetRef.current;
    const veil = veilRef.current;
    if (!sheet) return;
    if (animate) {
      sheet.style.transition = "transform 0.35s cubic-bezier(0.22, 1, 0.36, 1)";
    } else {
      sheet.style.transition = "none";
    }
    if (y >= 0) {
      sheet.style.transform = `translateY(${y}px)`;
    }
    if (veil) {
      const opacity = Math.max(0, 1 - y / 400);
      veil.style.opacity = String(opacity);
    }
  };

  const dismiss = () => {
    const sheet = sheetRef.current;
    const veil = veilRef.current;
    if (sheet) {
      sheet.style.transition = "transform 0.3s cubic-bezier(0.4, 0, 1, 1)";
      sheet.style.transform = "translateY(110%)";
    }
    if (veil) {
      veil.style.transition = "opacity 0.25s ease";
      veil.style.opacity = "0";
    }
    setTimeout(() => {
      onClose();
      if (sheet) {
        sheet.style.transition = "none";
        sheet.style.transform = "";
      }
      if (veil) {
        veil.style.transition = "none";
        veil.style.opacity = "";
      }
    }, 300);
  };

  const snapBack = () => {
    setSheetPosition(0, true);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const scrollEl = sheetRef.current?.querySelector(".inspector-scroll");
    if (scrollEl && scrollEl.scrollTop > 2) {
      canDragRef.current = false;
      return;
    }
    canDragRef.current = true;
    draggingRef.current = false;
    startYRef.current = e.touches[0].clientY;
    lastYRef.current = e.touches[0].clientY;
    lastTimeRef.current = Date.now();
    velocityRef.current = 0;
    currentYRef.current = 0;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!canDragRef.current) return;
    const touchY = e.touches[0].clientY;
    const now = Date.now();
    const rawDelta = touchY - startYRef.current;

    const dt = now - lastTimeRef.current;
    if (dt > 0) {
      const instantVelocity = (touchY - lastYRef.current) / dt;
      velocityRef.current = velocityRef.current * 0.7 + instantVelocity * 0.3;
    }
    lastYRef.current = touchY;
    lastTimeRef.current = now;

    if (rawDelta > 0) {
      if (!draggingRef.current && rawDelta > 8) {
        draggingRef.current = true;
        const sheet = sheetRef.current;
        if (sheet) sheet.style.transition = "none";
      }
      if (draggingRef.current) {
        const damped = rawDelta * 0.75;
        currentYRef.current = damped;
        setSheetPosition(damped, false);
      }
    } else {
      if (draggingRef.current && currentYRef.current > 0) {
        currentYRef.current = 0;
        setSheetPosition(0, false);
      }
    }
  };

  const handleTouchEnd = () => {
    if (!canDragRef.current) return;
    canDragRef.current = false;

    if (!draggingRef.current) {
      return;
    }

    const dist = currentYRef.current;
    const vel = velocityRef.current * 1000;

    if (dist > DISMISS_DISTANCE || vel > VELOCITY_DISMISS * 1000) {
      dismiss();
    } else {
      snapBack();
    }

    draggingRef.current = false;
    currentYRef.current = 0;
    velocityRef.current = 0;
  };

  const eligibleReminder = bucketId
    ? reminders.find(
      (reminder) =>
        !reminder.dismissed &&
        reminder.memories.some((memory) => memory.bucketId === bucketId)
    ) ?? reminders.find((reminder) => !reminder.dismissed)
    : undefined;

  const handleReignite = async () => {
    if (!bucketId || reigniting || !eligibleReminder) return;
    setReigniting(true);
    try {
      await boost(eligibleReminder.reminderId, [bucketId]);
      onReignited(bucketId);
      await Promise.all([refetch(), check()]);
    } finally {
      setReigniting(false);
    }
  };

  const handleSave = async () => {
    if (!bucketId || saving) return;
    setSaving(true);
    try {
      await api.memories.update(bucketId, {
        canonical: editCanonical.trim() || undefined,
        importance: editImportance,
        conceptType: editType,
      });
      setEditing(false);
      await refetch();
    } finally {
      setSaving(false);
    }
  };

  const jumpTo = (rawName: string | undefined | null) => {
    const targetId = bridge.resolveId(rawName);
    if (!targetId) return;
    bridge.select(targetId);
    bridge.focus(targetId);
  };

  const strengthPct = shown ? Math.round(shown.bucket.strength * 100) : 0;
  const accessLabel = shown
    ? shown.bucket.daysSinceAccess < 1
      ? "accessed today"
      : `accessed ${Math.round(shown.bucket.daysSinceAccess)}d ago`
    : "";
  const primaryDefinition = shown?.items[0]?.definition ?? null;

  return createPortal(
    <>
      <div
        ref={veilRef}
        className={`inspector-veil ${open ? "open" : ""}`}
        onClick={() => dismiss()}
      />
      <aside
        ref={sheetRef}
        className={`inspector ${open ? "open" : ""}`}
        aria-hidden={!open}
      >
        <div
          className="inspector-drag-zone"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="inspector-grabber" />
        </div>

        {shown && (
          <>
            <div className="inspector-head">
              <span className="type-badge" data-type={shown.bucket.conceptType}>
                {CONCEPT_TYPES[shown.bucket.conceptType]?.label ??
                  shown.bucket.conceptType}
              </span>
              <span className="ml-auto" />
              <button className="inspector-close" onClick={() => dismiss()} aria-label="Close memory panel">
                <Icon name="close" size={16} />
              </button>
            </div>

            {editing ? (
              <div className="flex flex-col gap-4 px-6 pt-5">
                <div className="field mb-0">
                  <label className="label">Canonical name</label>
                  <input
                    className="input"
                    value={editCanonical}
                    onChange={(event) => setEditCanonical(event.target.value)}
                  />
                </div>
                <div className="field mb-0">
                  <div className="flex items-baseline justify-between">
                    <label className="label">Importance</label>
                    <span className="t-mono text-[11px] text-ember-hi">
                      {editImportance}/10
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={editImportance}
                    onChange={(event) => setEditImportance(Number(event.target.value))}
                    className="w-full accent-ember"
                  />
                </div>
                <div className="field mb-0">
                  <label className="label">Concept type</label>
                  <select
                    className="select"
                    value={editType}
                    onChange={(event) => setEditType(event.target.value as ConceptType)}
                  >
                    {CONCEPT_TYPE_ORDER.map((type) => (
                      <option key={type} value={type}>
                        {CONCEPT_TYPES[type].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => void handleSave()}
                    disabled={saving}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-6 pt-4">
                <p className="t-mono text-[8px] uppercase tracking-[0.28em] text-stone">
                  Memory
                </p>
                <h2 className="inspector-name">{shown.bucket.canonical}</h2>
                {primaryDefinition && <p className="inspector-def">{primaryDefinition}</p>}
              </div>
            )}

            <div className="inspector-scroll">
              <section>
                <p className="insp-section-label">Strength</p>
                <div className="strength-meter" data-cat={shown.bucket.category}>
                  <span className="strength-value">{strengthPct}%</span>
                  <span className="strength-cat">{shown.bucket.category}</span>
                </div>
                <div className="strength-track">
                  <div className="strength-fill" style={{ width: `${strengthPct}%` }} />
                </div>
                <div className="strength-meta">
                  <span>{shown.bucket.accessCount} accesses</span>
                  <span>{accessLabel}</span>
                </div>
              </section>

              <section>
                <p className="insp-section-label">Decay · 30 days</p>
                <DecayCurveChart
                  points={shown.decayCurve}
                  strength={shown.bucket.strength}
                  category={shown.bucket.category}
                />
              </section>

              {shown.relationships.length > 0 && (
                <section>
                  <p className="insp-section-label">
                    Connections · {shown.relationships.length}
                  </p>
                  <div className="flex flex-col gap-1">
                    {shown.relationships.map((relationship) => {
                      const meta = RELATIONSHIP_TYPES[relationship.relationType];
                      const displayName =
                        relationship.connectedBucketName ??
                        relationship.connectedBucketId ??
                        "Unknown";
                      return (
                        <button
                          key={relationship.relationshipId}
                          className="conn-row"
                          onClick={() =>
                            jumpTo(relationship.connectedBucketName ?? relationship.connectedBucketId)
                          }
                        >
                          <span
                            className={`conn-glyph ${relationship.direction === "incoming" ? "incoming" : ""}`}
                          >
                            {meta?.symbol ?? "?"}
                          </span>
                          <span className="conn-name">{displayName}</span>
                          <span className="conn-type">
                            {relationship.direction === "incoming"
                              ? meta?.inverseLabel
                              : meta?.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}

              {shown.items.length > 0 && (
                <section>
                  <p className="insp-section-label">Sources · {shown.items.length}</p>
                  <div className="source-list">
                    {shown.items.map((item) => (
                      <div key={item.itemId} className="item-row">
                        <p className="item-label">{item.label}</p>
                        {item.definition && <p className="item-def">{item.definition}</p>}
                        <div className="mt-2 flex items-center gap-2">
                          {item.source && <span className="source-chip">{item.source}</span>}
                          <span className="t-mono text-[9px] uppercase tracking-[0.16em] text-stone/60">
                            {formatDay(item.timestamp)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>

            <div className="inspector-foot">
              <button
                className={`reignite-btn ${reigniting ? "firing" : ""}`}
                onClick={() => void handleReignite()}
                disabled={!eligibleReminder || reigniting}
                title={
                  eligibleReminder
                    ? "Boost this memory back to full strength"
                    : "Fading memories reignite when a reminder exists"
                }
              >
                <Icon name="refresh" size={16} />
                {reigniting ? "Reigniting…" : "Reignite"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => bridge.focus(shown.bucket.bucketId)}
                aria-label="Focus in graph"
              >
                <Icon name="search" size={15} />
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => setEditing(true)}
                aria-label="Edit memory"
              >
                <Icon name="edit" size={15} />
              </button>
            </div>
          </>
        )}
        {!shown && loading && (
          <div className="flex flex-col gap-4 px-6 pt-8">
            <div className="h-5 w-24 animate-pulse rounded-full bg-soot" />
            <div className="h-9 w-3/4 animate-pulse rounded-lg bg-soot" />
            <div className="h-4 w-full animate-pulse rounded bg-soot" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-soot" />
          </div>
        )}
      </aside>
    </>,
    document.body
  );
}