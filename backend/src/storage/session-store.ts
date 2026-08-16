import { query, queryOne, queryMany, withTransaction } from "../database";
import {
  Session,
  SessionRow,
  SessionWithPreview,
  mapRowToSession,
  mapRowToSessionWithPreview,
} from "../models/session.model";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger";

export class SessionStore {
  async createSession(userId: string, title?: string): Promise<Session> {
    try {
      const sessionId = uuidv4();
      const sessionTitle = title ?? "New conversation";
      const row = await queryOne<SessionRow>(
        `INSERT INTO sessions (session_id, user_id, title)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [sessionId, userId, sessionTitle]
      );
      if (!row) {
        throw new Error("Failed to create session: no row returned");
      }
      return mapRowToSession(row);
    } catch (error) {
      logger.error("createSession failed", {
        userId,
        title,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getSession(sessionId: string): Promise<Session | null> {
    try {
      const row = await queryOne<SessionRow>(
        "SELECT * FROM sessions WHERE session_id = $1",
        [sessionId]
      );
      return row ? mapRowToSession(row) : null;
    } catch (error) {
      logger.error("getSession failed", {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getSessionWithPreview(sessionId: string): Promise<SessionWithPreview | null> {
    try {
      const row = await queryOne<
        SessionRow & {
          last_message: string | null;
          last_message_role: string | null;
          last_message_at: Date | null;
        }
      >(
        `SELECT s.*,
                lm.content AS last_message,
                lm.role AS last_message_role,
                lm.timestamp AS last_message_at
         FROM sessions s
         LEFT JOIN LATERAL (
           SELECT content, role, timestamp
           FROM messages
           WHERE session_id = s.session_id
           ORDER BY timestamp DESC
           LIMIT 1
         ) lm ON true
         WHERE s.session_id = $1`,
        [sessionId]
      );
      return row ? mapRowToSessionWithPreview(row) : null;
    } catch (error) {
      logger.error("getSessionWithPreview failed", {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getSessionsByUser(userId: string): Promise<SessionWithPreview[]> {
    try {
      const rows = await queryMany<
        SessionRow & {
          last_message: string | null;
          last_message_role: string | null;
          last_message_at: Date | null;
        }
      >(
        `SELECT s.*,
                lm.content AS last_message,
                lm.role AS last_message_role,
                lm.timestamp AS last_message_at
         FROM sessions s
         LEFT JOIN LATERAL (
           SELECT content, role, timestamp
           FROM messages
           WHERE session_id = s.session_id
           ORDER BY timestamp DESC
           LIMIT 1
         ) lm ON true
         WHERE s.user_id = $1
         ORDER BY s.updated_at DESC`,
        [userId]
      );
      return rows.map(mapRowToSessionWithPreview);
    } catch (error) {
      logger.error("getSessionsByUser failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updateSession(sessionId: string, title: string): Promise<Session | null> {
    try {
      const row = await queryOne<SessionRow>(
        `UPDATE sessions
         SET title = $1, updated_at = now()
         WHERE session_id = $2
         RETURNING *`,
        [title, sessionId]
      );
      return row ? mapRowToSession(row) : null;
    } catch (error) {
      logger.error("updateSession failed", {
        sessionId,
        title,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async setTitleIfDefault(sessionId: string, title: string): Promise<void> {
    try {
      await query(
        `UPDATE sessions
         SET title = $1, updated_at = now()
         WHERE session_id = $2
           AND (title = 'New conversation' OR title IS NULL OR title = '')`,
        [title, sessionId]
      );
    } catch (error) {
      logger.error("setTitleIfDefault failed", {
        sessionId,
        error: (error as Error).message,
      });
    }
  }

  async updateSessionActivity(sessionId: string): Promise<void> {
    try {
      await query(
        `UPDATE sessions
         SET updated_at = now(), message_count = message_count + 1
         WHERE session_id = $1`,
        [sessionId]
      );
    } catch (error) {
      logger.error("updateSessionActivity failed", {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      return await withTransaction(async (client) => {
        await client.query(
          "DELETE FROM messages WHERE session_id = $1",
          [sessionId]
        );
        const result = await client.query(
          "DELETE FROM sessions WHERE session_id = $1",
          [sessionId]
        );
        return (result.rowCount ?? 0) > 0;
      });
    } catch (error) {
      logger.error("deleteSession failed", {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getTotalCount(userId?: string): Promise<number> {
    try {
      if (userId) {
        const row = await queryOne<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM sessions WHERE user_id = $1",
          [userId]
        );
        return row?.count ?? 0;
      }
      const row = await queryOne<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM sessions"
      );
      return row?.count ?? 0;
    } catch (error) {
      logger.error("getTotalCount failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async exists(sessionId: string): Promise<boolean> {
    try {
      const row = await queryOne<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id = $1) AS exists",
        [sessionId]
      );
      return row?.exists ?? false;
    } catch (error) {
      logger.error("exists failed", {
        sessionId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async belongsToUser(sessionId: string, userId: string): Promise<boolean> {
    try {
      const row = await queryOne<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE session_id = $1 AND user_id = $2) AS exists",
        [sessionId, userId]
      );
      return row?.exists ?? false;
    } catch (error) {
      logger.error("belongsToUser failed", {
        sessionId,
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getRecentSessions(limit: number = 10): Promise<Session[]> {
    try {
      const rows = await queryMany<SessionRow>(
        "SELECT * FROM sessions ORDER BY updated_at DESC LIMIT $1",
        [limit]
      );
      return rows.map(mapRowToSession);
    } catch (error) {
      logger.error("getRecentSessions failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }
  async getDocumentId(_sessionId: string): Promise<string | null> {
    return null;
  }
}

let sessionStoreInstance: SessionStore | null = null;

export function getSessionStore(): SessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new SessionStore();
  }
  return sessionStoreInstance;
}