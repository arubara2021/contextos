export interface TokenPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface UserRow {
  user_id: string;
  email: string;
  password_hash: string;
  display_name: string;
  is_sandbox: boolean;
  expires_at: Date | string | null;
  upload_count: number | string;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface User {
  userId: string;
  email: string;
  displayName: string;
  passwordHash: string;
  isSandbox: boolean;
  expiresAt: string | null;
  uploadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserResponse {
  userId: string;
  email: string;
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserCreateParams {
  email: string;
  password?: string;
  passwordHash?: string;
  displayName?: string;
}

export interface UserUpdateParams {
  email?: string;
  displayName?: string;
}

export interface PasswordUpdateParams {
  currentPassword: string;
  newPassword: string;
}

export interface LoginParams {
  email: string;
  password: string;
}

export interface ValidationResult<T> {
  params: T | null;
  errors: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;
const MAX_DISPLAY_NAME_LENGTH = 80;

function toIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function mapRowToUser(row: UserRow): User {
  const email = String(row.email ?? "");
  return {
    userId: String(row.user_id),
    email,
    displayName:
      String(row.display_name ?? "").trim() || email.split("@")[0] || "User",
    passwordHash: String(row.password_hash ?? ""),
    isSandbox: Boolean(row.is_sandbox),
    expiresAt: toIso(row.expires_at),
    uploadCount: Number(row.upload_count ?? 0) || 0,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

export function toUserResponse(user: User): UserResponse {
  return {
    userId: user.userId,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function validateUserCreate(
  body: unknown
): ValidationResult<UserCreateParams> {
  const errors: string[] = [];
  const obj = (body ?? {}) as Record<string, unknown>;

  const email =
    typeof obj.email === "string" ? obj.email.trim().toLowerCase() : "";
  const password = typeof obj.password === "string" ? obj.password : "";
  const displayName =
    typeof obj.displayName === "string" ? obj.displayName.trim() : "";

  if (!email) {
    errors.push("email is required");
  } else if (!EMAIL_RE.test(email)) {
    errors.push("email is invalid");
  } else if (email.length > MAX_EMAIL_LENGTH) {
    errors.push("email is too long");
  }

  if (!password) {
    errors.push("password is required");
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push("password is too long");
  }

  if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
    errors.push("displayName is too long");
  }

  if (errors.length > 0) {
    return { params: null, errors };
  }

  return {
    params: {
      email,
      password,
      ...(displayName.length > 0 ? { displayName } : {}),
    },
    errors: [],
  };
}

export function validateUserUpdate(
  body: unknown
): ValidationResult<UserUpdateParams> {
  const errors: string[] = [];
  const obj = (body ?? {}) as Record<string, unknown>;
  const params: UserUpdateParams = {};

  if (obj.email !== undefined) {
    const email =
      typeof obj.email === "string" ? obj.email.trim().toLowerCase() : "";
    if (!email || !EMAIL_RE.test(email)) {
      errors.push("email is invalid");
    } else if (email.length > MAX_EMAIL_LENGTH) {
      errors.push("email is too long");
    } else {
      params.email = email;
    }
  }

  if (obj.displayName !== undefined) {
    const displayName =
      typeof obj.displayName === "string" ? obj.displayName.trim() : "";
    if (displayName.length > MAX_DISPLAY_NAME_LENGTH) {
      errors.push("displayName is too long");
    } else {
      params.displayName = displayName;
    }
  }

  if (
    errors.length === 0 &&
    params.email === undefined &&
    params.displayName === undefined
  ) {
    errors.push("nothing to update — provide email or displayName");
  }

  if (errors.length > 0) {
    return { params: null, errors };
  }

  return { params, errors: [] };
}

export function validatePasswordUpdate(
  body: unknown
): ValidationResult<PasswordUpdateParams> {
  const errors: string[] = [];
  const obj = (body ?? {}) as Record<string, unknown>;

  const currentPassword =
    typeof obj.currentPassword === "string" ? obj.currentPassword : "";
  const newPassword =
    typeof obj.newPassword === "string" ? obj.newPassword : "";

  if (!currentPassword) {
    errors.push("currentPassword is required");
  }

  if (!newPassword) {
    errors.push("newPassword is required");
  } else if (newPassword.length < MIN_PASSWORD_LENGTH) {
    errors.push(
      `newPassword must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
  } else if (newPassword.length > MAX_PASSWORD_LENGTH) {
    errors.push("newPassword is too long");
  }

  if (errors.length > 0) {
    return { params: null, errors };
  }

  return { params: { currentPassword, newPassword }, errors: [] };
}

export function validateLogin(body: unknown): LoginParams | null {
  const obj = (body ?? {}) as Record<string, unknown>;
  const email =
    typeof obj.email === "string" ? obj.email.trim().toLowerCase() : "";
  const password = typeof obj.password === "string" ? obj.password : "";

  if (!email || !password) {
    return null;
  }

  return { email, password };
}