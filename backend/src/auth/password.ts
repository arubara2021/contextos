import bcrypt from "bcrypt";
import config from "../config";

const ROUNDS = config.auth.bcryptRounds;
const MAX_PASSWORD_LENGTH = 72;

export async function hashPassword(password: string): Promise<string> {
  if (!password || password.length === 0) {
    throw new Error("Password cannot be empty");
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`Password cannot exceed ${MAX_PASSWORD_LENGTH} characters`);
  }

  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!password || !hash) {
    return false;
  }

  try {
    return await bcrypt.compare(password, hash);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!password || password.length === 0) {
    return {
      valid: false,
      errors: ["Password is required"],
    };
  }

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters");
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push(`Password cannot exceed ${MAX_PASSWORD_LENGTH} characters`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}