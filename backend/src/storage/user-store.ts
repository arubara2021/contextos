import { query, queryOne, queryMany, withTransaction } from "../database";
import {
  User,
  UserRow,
  UserResponse,
  UserCreateParams,
  UserUpdateParams,
  mapRowToUser,
  toUserResponse,
} from "../models/user.model";
import { hashPassword } from "../auth/password";
import { v4 as uuidv4 } from "uuid";
import logger from "../utils/logger";

export class UserStore {
  async createUser(params: UserCreateParams): Promise<User> {
    try {
      const userId = uuidv4();
      if (!params.password) {
        throw new Error("Password is required");
      }
      const passwordHash = await hashPassword(params.password);
      const displayName = params.displayName ?? params.email.split("@")[0];

      const row = await queryOne<UserRow>(
        `INSERT INTO users (user_id, email, password_hash, display_name)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, params.email.toLowerCase(), passwordHash, displayName]
      );

      if (!row) {
        throw new Error("Failed to create user: no row returned");
      }

      return mapRowToUser(row);
    } catch (error) {
      const err = error as Error;
      if (err.message.includes("duplicate") || err.message.includes("unique")) {
        logger.warn("User creation failed: email already exists", {
          email: params.email,
        });
        throw new Error("Email already registered");
      }
      logger.error("createUser failed", {
        email: params.email,
        error: err.message,
      });
      throw error;
    }
  }

  async createSandboxUser(
    params: UserCreateParams & { ttlMinutes: number }
  ): Promise<User> {
    try {
      const userId = uuidv4();
      if (!params.password) {
        throw new Error("Password is required");
      }
      const passwordHash = await hashPassword(params.password);
      const displayName = params.displayName ?? "Sandbox Explorer";
      const expiresAt = new Date(Date.now() + params.ttlMinutes * 60 * 1000);

      const row = await queryOne<UserRow>(
        `INSERT INTO users (user_id, email, password_hash, display_name, is_sandbox, expires_at, upload_count)
         VALUES ($1, $2, $3, $4, true, $5, 0)
         RETURNING *`,
        [userId, params.email.toLowerCase(), passwordHash, displayName, expiresAt]
      );

      if (!row) {
        throw new Error("Failed to create sandbox user: no row returned");
      }

      return mapRowToUser(row);
    } catch (error) {
      logger.error("createSandboxUser failed", {
        email: params.email,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async tryConsumeSandboxUpload(userId: string, cap: number): Promise<boolean> {
    try {
      const result = await query(
        `UPDATE users
         SET upload_count = upload_count + 1
         WHERE user_id = $1 AND is_sandbox = true AND upload_count < $2
         RETURNING upload_count`,
        [userId, cap]
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("tryConsumeSandboxUpload failed", {
        userId,
        cap,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const row = await queryOne<UserRow>(
        "SELECT * FROM users WHERE email = $1",
        [email.toLowerCase()]
      );
      return row ? mapRowToUser(row) : null;
    } catch (error) {
      logger.error("getUserByEmail failed", {
        email,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getUserById(userId: string): Promise<User | null> {
    try {
      const row = await queryOne<UserRow>(
        "SELECT * FROM users WHERE user_id = $1",
        [userId]
      );
      return row ? mapRowToUser(row) : null;
    } catch (error) {
      logger.error("getUserById failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getUserResponse(userId: string): Promise<UserResponse | null> {
    try {
      const user = await this.getUserById(userId);
      return user ? toUserResponse(user) : null;
    } catch (error) {
      logger.error("getUserResponse failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async updateUser(userId: string, updates: UserUpdateParams): Promise<User | null> {
    try {
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (updates.email !== undefined) {
        fields.push(`email = $${idx++}`);
        values.push(updates.email.toLowerCase());
      }
      if (updates.displayName !== undefined) {
        fields.push(`display_name = $${idx++}`);
        values.push(updates.displayName);
      }

      if (fields.length === 0) {
        return this.getUserById(userId);
      }

      fields.push("updated_at = now()");
      values.push(userId);

      const row = await queryOne<UserRow>(
        `UPDATE users
         SET ${fields.join(", ")}
         WHERE user_id = $${idx}
         RETURNING *`,
        values
      );

      return row ? mapRowToUser(row) : null;
    } catch (error) {
      const err = error as Error;
      if (err.message.includes("duplicate") || err.message.includes("unique")) {
        logger.warn("User update failed: email already taken", {
          userId,
          email: updates.email,
        });
        throw new Error("Email already registered");
      }
      logger.error("updateUser failed", {
        userId,
        updates,
        error: err.message,
      });
      throw error;
    }
  }

  async updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    try {
      const result = await query(
        `UPDATE users
         SET password_hash = $1, updated_at = now()
         WHERE user_id = $2`,
        [passwordHash, userId]
      );
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      logger.error("updatePassword failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async deleteUser(userId: string): Promise<boolean> {
    try {
      return await withTransaction(async (client) => {
        const sessionRows = await client.query(
          "SELECT session_id FROM sessions WHERE user_id = $1",
          [userId]
        );
        const sessionIds = sessionRows.rows.map((r) => r.session_id as string);

        if (sessionIds.length > 0) {
          await client.query(
            "DELETE FROM messages WHERE session_id = ANY($1)",
            [sessionIds]
          );
          await client.query(
            "DELETE FROM sessions WHERE user_id = $1",
            [userId]
          );
        }

        await client.query(
          "DELETE FROM reminders WHERE user_id = $1",
          [userId]
        );

        const result = await client.query(
          "DELETE FROM users WHERE user_id = $1",
          [userId]
        );

        return (result.rowCount ?? 0) > 0;
      });
    } catch (error) {
      logger.error("deleteUser failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async listUsers(limit: number = 50, offset: number = 0): Promise<UserResponse[]> {
    try {
      const rows = await queryMany<UserRow>(
        "SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2",
        [limit, offset]
      );
      return rows.map((row) => toUserResponse(mapRowToUser(row)));
    } catch (error) {
      logger.error("listUsers failed", {
        limit,
        offset,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async getTotalCount(): Promise<number> {
    try {
      const row = await queryOne<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM users"
      );
      return row?.count ?? 0;
    } catch (error) {
      logger.error("getTotalCount failed", {
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async exists(userId: string): Promise<boolean> {
    try {
      const row = await queryOne<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE user_id = $1) AS exists",
        [userId]
      );
      return row?.exists ?? false;
    } catch (error) {
      logger.error("exists failed", {
        userId,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  async emailExists(email: string): Promise<boolean> {
    try {
      const row = await queryOne<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE email = $1) AS exists",
        [email.toLowerCase()]
      );
      return row?.exists ?? false;
    } catch (error) {
      logger.error("emailExists failed", {
        email,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}

let userStoreInstance: UserStore | null = null;

export function getUserStore(): UserStore {
  if (!userStoreInstance) {
    userStoreInstance = new UserStore();
  }
  return userStoreInstance;
}