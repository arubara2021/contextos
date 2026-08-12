import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { REMINDER_POLL_INTERVAL_MS } from "../constants";
import type { Contradiction, Reminder, ReminderAction } from "../types";

interface ReminderSnapshot {
  reminder: Reminder | null;
  criticalCount: number;
  reminders: Reminder[];
  contradictions: Contradiction[];
}

interface ReminderSubscriber {
  apply: (snapshot: ReminderSnapshot) => void;
  setChecking: (value: boolean) => void;
}

const COALESCE_MS = 120;

let subscribers = new Set<ReminderSubscriber>();
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let intervalTimer: ReturnType<typeof setInterval> | null = null;
let inFlight: Promise<void> | null = null;

async function runSharedCheck(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const [checkResult, listResult, contradictionResult] = await Promise.all([
        api.reminders.check(),
        api.reminders.list(),
        api.reminders.contradictions(),
      ]);
      const snapshot: ReminderSnapshot = {
        reminder: checkResult.reminder,
        criticalCount: checkResult.criticalCount,
        reminders: listResult.reminders,
        contradictions: contradictionResult.contradictions,
      };
      for (const sub of subscribers) {
        sub.apply(snapshot);
        sub.setChecking(false);
      }
    } catch {
      for (const sub of subscribers) {
        sub.setChecking(false);
      }
    }
  })();
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
}

function ensureRunning(): void {
  if (!intervalTimer) {
    intervalTimer = window.setInterval(
      () => void runSharedCheck(),
      REMINDER_POLL_INTERVAL_MS
    );
  }
  if (!coalesceTimer) {
    coalesceTimer = window.setTimeout(() => {
      coalesceTimer = null;
      void runSharedCheck();
    }, COALESCE_MS);
  }
}

function stopIfEmpty(): void {
  if (subscribers.size > 0) return;
  if (intervalTimer) {
    window.clearInterval(intervalTimer);
    intervalTimer = null;
  }
  if (coalesceTimer) {
    window.clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
}

function subscribe(sub: ReminderSubscriber): () => void {
  subscribers.add(sub);
  sub.setChecking(true);
  ensureRunning();
  return () => {
    subscribers.delete(sub);
    stopIfEmpty();
  };
}

export function useReminders(enabled = true) {
  const [reminder, setReminder] = useState<Reminder | null>(null);
  const [criticalCount, setCriticalCount] = useState(0);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [contradictions, setContradictions] = useState<Contradiction[]>([]);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const sub: ReminderSubscriber = {
      apply: (snapshot) => {
        setReminder(snapshot.reminder);
        setCriticalCount(snapshot.criticalCount);
        setReminders(snapshot.reminders);
        setContradictions(snapshot.contradictions);
      },
      setChecking,
    };
    return subscribe(sub);
  }, [enabled]);

  const check = useCallback(async () => {
    if (!enabled) return;
    setChecking(true);
    await runSharedCheck();
  }, [enabled]);

  const dismiss = useCallback(async (reminderId: string) => {
    await api.reminders.dismiss(reminderId);
    setReminder((r) => (r && r.reminderId === reminderId ? null : r));
    setReminders((list) =>
      list.map((r) =>
        r.reminderId === reminderId ? { ...r, dismissed: true } : r
      )
    );
    void runSharedCheck();
  }, []);

  const act = useCallback(
    async (reminderId: string, action: ReminderAction, bucketIds?: string[]) => {
      await api.reminders.action(reminderId, action, bucketIds);
      if (action !== "keep_active") {
        setReminder((r) => (r && r.reminderId === reminderId ? null : r));
      }
      setReminders((list) =>
        list.map((r) =>
          r.reminderId === reminderId ? { ...r, actionTaken: action } : r
        )
      );
      void runSharedCheck();
    },
    []
  );

  const boost = useCallback(
    async (reminderId: string, bucketIds: string[]) =>
      act(reminderId, "boost", bucketIds),
    [act]
  );

  const resolveContradiction = useCallback(async (contradictionId: string) => {
    await api.reminders.resolveContradiction(contradictionId);
    setContradictions((list) =>
      list.filter((c) => c.contradictionId !== contradictionId)
    );
    void runSharedCheck();
  }, []);

  return {
    reminder,
    criticalCount,
    reminders,
    contradictions,
    checking,
    check,
    dismiss,
    act,
    boost,
    resolveContradiction,
  };
}