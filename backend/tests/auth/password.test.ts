import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
} from "../../src/auth/password";
import bcrypt from "bcrypt";

jest.mock("bcrypt");

const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe("hashPassword", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("hashes a valid password", async () => {
    mockedBcrypt.hash.mockResolvedValue("$2b$12$hashedpassword" as never);

    const result = await hashPassword("SecurePass123");

    expect(result).toBe("$2b$12$hashedpassword");
    expect(mockedBcrypt.hash).toHaveBeenCalledWith("SecurePass123", 12);
  });

  it("throws for empty password", async () => {
    await expect(hashPassword("")).rejects.toThrow("Password cannot be empty");
    expect(mockedBcrypt.hash).not.toHaveBeenCalled();
  });

  it("throws for password exceeding 72 characters", async () => {
    const longPassword = "a".repeat(73);

    await expect(hashPassword(longPassword)).rejects.toThrow(
      "Password cannot exceed 72 characters"
    );
    expect(mockedBcrypt.hash).not.toHaveBeenCalled();
  });

  it("accepts password at exactly 72 characters", async () => {
    const password72 = "a".repeat(72);
    mockedBcrypt.hash.mockResolvedValue("$2b$12$hash" as never);

    const result = await hashPassword(password72);

    expect(result).toBe("$2b$12$hash");
    expect(mockedBcrypt.hash).toHaveBeenCalledWith(password72, 12);
  });

  it("throws for null password", async () => {
    await expect(hashPassword(null as any)).rejects.toThrow(
      "Password cannot be empty"
    );
  });

  it("throws for undefined password", async () => {
    await expect(hashPassword(undefined as any)).rejects.toThrow(
      "Password cannot be empty"
    );
  });

  it("handles special characters in password", async () => {
    const specialPassword = "P@$$w0rd!#%^&*()_+-=";
    mockedBcrypt.hash.mockResolvedValue("$2b$12$hash" as never);

    const result = await hashPassword(specialPassword);

    expect(result).toBe("$2b$12$hash");
    expect(mockedBcrypt.hash).toHaveBeenCalledWith(specialPassword, 12);
  });

  it("handles unicode characters in password", async () => {
    const unicodePassword = "パスワード123🔐";
    mockedBcrypt.hash.mockResolvedValue("$2b$12$hash" as never);

    const result = await hashPassword(unicodePassword);

    expect(result).toBe("$2b$12$hash");
  });
});

describe("verifyPassword", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns true for matching password", async () => {
    mockedBcrypt.compare.mockResolvedValue(true as never);

    const result = await verifyPassword("SecurePass123", "$2b$12$hash");

    expect(result).toBe(true);
    expect(mockedBcrypt.compare).toHaveBeenCalledWith(
      "SecurePass123",
      "$2b$12$hash"
    );
  });

  it("returns false for non-matching password", async () => {
    mockedBcrypt.compare.mockResolvedValue(false as never);

    const result = await verifyPassword("WrongPassword", "$2b$12$hash");

    expect(result).toBe(false);
  });

  it("returns false for empty password", async () => {
    const result = await verifyPassword("", "$2b$12$hash");

    expect(result).toBe(false);
    expect(mockedBcrypt.compare).not.toHaveBeenCalled();
  });

  it("returns false for empty hash", async () => {
    const result = await verifyPassword("password", "");

    expect(result).toBe(false);
    expect(mockedBcrypt.compare).not.toHaveBeenCalled();
  });

  it("returns false for null password", async () => {
    const result = await verifyPassword(null as any, "$2b$12$hash");

    expect(result).toBe(false);
  });

  it("returns false for null hash", async () => {
    const result = await verifyPassword("password", null as any);

    expect(result).toBe(false);
  });

  it("returns false when bcrypt throws", async () => {
    mockedBcrypt.compare.mockRejectedValue(new Error("Invalid hash") as never);

    const result = await verifyPassword("password", "invalid-hash");

    expect(result).toBe(false);
  });

  it("returns false when both arguments are empty", async () => {
    const result = await verifyPassword("", "");

    expect(result).toBe(false);
  });
});

describe("validatePasswordStrength", () => {
  it("accepts a strong password", () => {
    const result = validatePasswordStrength("SecurePass123");

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects empty password", () => {
    const result = validatePasswordStrength("");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Password is required");
  });

  it("rejects null password", () => {
    const result = validatePasswordStrength(null as any);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Password is required");
  });

  it("rejects password shorter than 8 characters", () => {
    const result = validatePasswordStrength("Ab1");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Password must be at least 8 characters"
    );
  });

  it("rejects password longer than 72 characters", () => {
    const longPassword = "Aa1" + "x".repeat(70);

    const result = validatePasswordStrength(longPassword);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Password cannot exceed 72 characters"
    );
  });

  it("accepts password at exactly 8 characters", () => {
    const result = validatePasswordStrength("Abcdef1g");

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepts password at exactly 72 characters", () => {
    const password = "Abcdef1g" + "x".repeat(64);

    const result = validatePasswordStrength(password);

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects password without uppercase", () => {
    const result = validatePasswordStrength("lowercase123");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Password must contain at least one uppercase letter"
    );
  });

  it("rejects password without lowercase", () => {
    const result = validatePasswordStrength("UPPERCASE123");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Password must contain at least one lowercase letter"
    );
  });

  it("rejects password without number", () => {
    const result = validatePasswordStrength("NoNumbersHere");

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Password must contain at least one number"
    );
  });

  it("returns multiple errors for very weak password", () => {
    const result = validatePasswordStrength("abc");

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
    expect(result.errors).toContain(
      "Password must be at least 8 characters"
    );
    expect(result.errors).toContain(
      "Password must contain at least one uppercase letter"
    );
    expect(result.errors).toContain(
      "Password must contain at least one number"
    );
  });

  it("accepts password with special characters", () => {
    const result = validatePasswordStrength("P@ssw0rd!");

    expect(result.valid).toBe(true);
  });

  it("accepts password with spaces", () => {
    const result = validatePasswordStrength("My Pass 123 Word");

    expect(result.valid).toBe(true);
  });

  it("handles undefined password", () => {
    const result = validatePasswordStrength(undefined as any);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Password is required");
  });

  it("returns errors array even when valid", () => {
    const result = validatePasswordStrength("StrongPass1");

    expect(result.errors).toBeDefined();
    expect(Array.isArray(result.errors)).toBe(true);
    expect(result.errors).toEqual([]);
  });
});