export interface ReminderRow {
  reminder_id: string;
  user_id: string;
  message: string;
  dismissed: boolean;
  action_taken: string | null;
  created_at: Date;
}

export interface ReminderMemory {
  bucketId: string;
  canonical: string;
  strength: number;
  importance: number;
  daysSinceAccess: number;
}

export interface Reminder {
  reminderId: string;
  userId: string;
  message: string;
  memories: ReminderMemory[];
  dismissed: boolean;
  actionTaken: string | null;
  createdAt: Date;
}

export interface ReminderCheckResult {
  hasReminders: boolean;
  reminder: Reminder | null;
  criticalCount: number;
}

export interface ContradictionRow {
  contradiction_id: string;
  user_id: string;
  existing_bucket_id: string;
  new_information: string;
  conflict_description: string;
  resolved: boolean;
  created_at: Date;
}

export interface Contradiction {
  contradictionId: string;
  userId: string;
  existingBucketId: string;
  newInformation: string;
  conflictDescription: string;
  resolved: boolean;
  createdAt: Date;
}

export interface ContradictionCheckResult {
  hasContradictions: boolean;
  contradictions: Contradiction[];
}

export function mapRowToReminder(
  row: ReminderRow,
  memories: ReminderMemory[] = []
): Reminder {
  return {
    reminderId: row.reminder_id,
    userId: row.user_id,
    message: row.message,
    memories,
    dismissed: row.dismissed,
    actionTaken: row.action_taken,
    createdAt: new Date(row.created_at),
  };
}

export function mapRowToContradiction(row: ContradictionRow): Contradiction {
  return {
    contradictionId: row.contradiction_id,
    userId: row.user_id,
    existingBucketId: row.existing_bucket_id,
    newInformation: row.new_information,
    conflictDescription: row.conflict_description,
    resolved: row.resolved,
    createdAt: new Date(row.created_at),
  };
}

export function buildReminderMessage(memories: ReminderMemory[]): string {
  const names = memories.slice(0, 5).map((m) => m.canonical);
  const nameList = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const count = memories.length;
  return `You haven't discussed ${nameList} recently. ${count} key memor${count === 1 ? "y is" : "ies are"} fading. Should I keep them active?`;
}

export function createReminder(params: {
  userId: string;
  memories: ReminderMemory[];
  reminderId?: string;
}): Reminder {
  return {
    reminderId: params.reminderId ?? "",
    userId: params.userId,
    message: buildReminderMessage(params.memories),
    memories: params.memories,
    dismissed: false,
    actionTaken: null,
    createdAt: new Date(),
  };
}

export function emptyReminderCheck(): ReminderCheckResult {
  return {
    hasReminders: false,
    reminder: null,
    criticalCount: 0,
  };
}

export function createReminderCheck(reminder: Reminder, criticalCount: number): ReminderCheckResult {
  return {
    hasReminders: true,
    reminder,
    criticalCount,
  };
}

export function emptyContradictionCheck(): ContradictionCheckResult {
  return {
    hasContradictions: false,
    contradictions: [],
  };
}

export function createContradictionCheck(contradictions: Contradiction[]): ContradictionCheckResult {
  return {
    hasContradictions: contradictions.length > 0,
    contradictions,
  };
}

export function serializeReminderMemories(memories: ReminderMemory[]): string {
  return JSON.stringify(memories);
}

export function deserializeReminderMemories(raw: string | null): ReminderMemory[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item: unknown): item is ReminderMemory =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as ReminderMemory).bucketId === "string" &&
        typeof (item as ReminderMemory).canonical === "string"
    );
  } catch {
    return [];
  }
}