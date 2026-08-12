export interface SessionRow {
  session_id: string;
  user_id: string;
  title: string;
  created_at: Date;
  updated_at: Date;
  message_count: number;
}

export interface Session {
  sessionId: string;
  userId: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
}

export interface SessionWithPreview extends Session {
  lastMessage: string | null;
  lastMessageRole: string | null;
  lastMessageAt: Date | null;
}

export interface SessionCreateParams {
  userId: string;
  title?: string;
}

export interface SessionUpdateParams {
  title?: string;
}

export function mapRowToSession(row: SessionRow): Session {
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    title: row.title,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    messageCount: Number(row.message_count),
  };
}

export function mapRowToSessionWithPreview(
  row: SessionRow & {
    last_message: string | null;
    last_message_role: string | null;
    last_message_at: Date | null;
  }
): SessionWithPreview {
  const base = mapRowToSession(row);
  return {
    ...base,
    lastMessage: row.last_message,
    lastMessageRole: row.last_message_role,
    lastMessageAt: row.last_message_at ? new Date(row.last_message_at) : null,
  };
}

export function generateSessionTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 50) return cleaned;
  const truncated = cleaned.substring(0, 47);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated) + "...";
}

export function createSession(params: SessionCreateParams, sessionId?: string): Session {
  const now = new Date();
  return {
    sessionId: sessionId ?? "",
    userId: params.userId,
    title: params.title ?? "New conversation",
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  };
}

export function validateSessionCreate(body: unknown): SessionCreateParams | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.userId !== "string" || !obj.userId.trim()) return null;
  const title = typeof obj.title === "string" ? obj.title.trim() : undefined;
  if (title && title.length > 500) return null;
  return { userId: obj.userId.trim(), title: title || undefined };
}

export function validateSessionUpdate(body: unknown): SessionUpdateParams | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : undefined;
  if (!title) return null;
  if (title.length > 500) return null;
  return { title };
}