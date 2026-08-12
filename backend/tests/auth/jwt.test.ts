import jwt from "jsonwebtoken";
import {
  signToken,
  signRefreshToken,
  verifyToken,
  verifyRefreshToken,
  decodeTokenUnsafe,
  getTokenExpiration,
  isTokenExpired,
} from "../../src/auth/jwt";

jest.mock("jsonwebtoken");

const mockedJwt = jwt as jest.Mocked<typeof jwt>;

const TEST_PAYLOAD = {
  userId: "user-123",
  email: "test@example.com",
};

const TEST_SECRET = "test-secret-that-is-long-enough-for-validation-32chars";

describe("signToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("signs a token with correct payload", () => {
    mockedJwt.sign.mockReturnValue("signed-token" as never);

    const result = signToken(TEST_PAYLOAD);

    expect(result).toBe("signed-token");
    expect(mockedJwt.sign).toHaveBeenCalledWith(
      TEST_PAYLOAD,
      expect.any(String),
      expect.objectContaining({
        expiresIn: expect.any(String),
        issuer: "contextos",
        subject: "user-123",
      })
    );
  });

  it("includes userId and email in payload", () => {
    mockedJwt.sign.mockReturnValue("token" as never);

    signToken(TEST_PAYLOAD);

    const callArgs = mockedJwt.sign.mock.calls[0];
    const payload = callArgs[0] as { userId: string; email: string };

    expect(payload.userId).toBe("user-123");
    expect(payload.email).toBe("test@example.com");
  });

  it("throws when userId is missing", () => {
    expect(() =>
      signToken({ userId: "", email: "test@test.com" })
    ).toThrow("Token payload must contain userId and email");
  });

  it("throws when email is missing", () => {
    expect(() =>
      signToken({ userId: "user-1", email: "" })
    ).toThrow("Token payload must contain userId and email");
  });

  it("throws when both fields are missing", () => {
    expect(() => signToken({ userId: "", email: "" })).toThrow(
      "Token payload must contain userId and email"
    );
  });
});

describe("signRefreshToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("signs a refresh token with type field", () => {
    mockedJwt.sign.mockReturnValue("refresh-token" as never);

    const result = signRefreshToken(TEST_PAYLOAD);

    expect(result).toBe("refresh-token");

    const callArgs = mockedJwt.sign.mock.calls[0];
    const payload = callArgs[0] as { type: string };
    expect(payload.type).toBe("refresh");
  });

  it("throws when payload is invalid", () => {
    expect(() =>
      signRefreshToken({ userId: "", email: "" })
    ).toThrow("Token payload must contain userId and email");
  });

  it("uses issuer contextos", () => {
    mockedJwt.sign.mockReturnValue("token" as never);

    signRefreshToken(TEST_PAYLOAD);

    const callArgs = mockedJwt.sign.mock.calls[0];
    const options = callArgs[2] as { issuer: string };

    expect(options.issuer).toBe("contextos");
  });
});

describe("verifyToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("verifies a valid token", () => {
    const decoded = {
      userId: "user-123",
      email: "test@test.com",
      iat: 1000000,
      exp: 2000000,
    };

    mockedJwt.verify.mockReturnValue(decoded as never);

    const result = verifyToken("valid-token");

    expect(result.userId).toBe("user-123");
    expect(result.email).toBe("test@test.com");
    expect(mockedJwt.verify).toHaveBeenCalledWith(
      "valid-token",
      expect.any(String),
      expect.objectContaining({ issuer: "contextos" })
    );
  });

  it("throws for empty token", () => {
    expect(() => verifyToken("")).toThrow("Token is required");
    expect(mockedJwt.verify).not.toHaveBeenCalled();
  });

  it("throws for whitespace-only token", () => {
    expect(() => verifyToken("   ")).toThrow("Token is required");
  });

  it("throws for null token", () => {
    expect(() => verifyToken(null as any)).toThrow("Token is required");
  });

  it("throws Token expired for expired tokens", () => {
    const error = new jwt.TokenExpiredError("jwt expired", new Date());
    mockedJwt.verify.mockImplementation(() => {
      throw error;
    });

    expect(() => verifyToken("expired-token")).toThrow("Token expired");
  });

  it("throws Invalid token for malformed tokens", () => {
    const error = new jwt.JsonWebTokenError("invalid token");
    mockedJwt.verify.mockImplementation(() => {
      throw error;
    });

    expect(() => verifyToken("malformed")).toThrow("Invalid token");
  });

  it("throws for token not yet valid", () => {
    const error = new jwt.NotBeforeError(
      jwt.NotBeforeError,
      new Date()
    );
    mockedJwt.verify.mockImplementation(() => {
      throw error;
    });

    expect(() => verifyToken("future-token")).toThrow(
      "Token not yet valid"
    );
  });

  it("throws when decoded payload is missing userId", () => {
    mockedJwt.verify.mockReturnValue({
      userId: "",
      email: "test@test.com",
      iat: 1000,
      exp: 2000,
    } as never);

    expect(() => verifyToken("token")).toThrow("Invalid token payload");
  });

  it("throws when decoded payload is missing email", () => {
    mockedJwt.verify.mockReturnValue({
      userId: "user-1",
      email: "",
      iat: 1000,
      exp: 2000,
    } as never);

    expect(() => verifyToken("token")).toThrow("Invalid token payload");
  });
});

describe("verifyRefreshToken", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("verifies a valid refresh token", () => {
    const decoded = {
      userId: "user-123",
      email: "test@test.com",
      type: "refresh",
      iat: 1000000,
      exp: 2000000,
    };

    mockedJwt.verify.mockReturnValue(decoded as never);

    const result = verifyRefreshToken("refresh-token");

    expect(result.userId).toBe("user-123");
  });

  it("throws for access token used as refresh token", () => {
    const decoded = {
      userId: "user-123",
      email: "test@test.com",
      type: "access",
      iat: 1000000,
      exp: 2000000,
    };

    mockedJwt.verify.mockReturnValue(decoded as never);

    expect(() => verifyRefreshToken("access-token")).toThrow(
      "Invalid token type: expected refresh token"
    );
  });

  it("throws for token without type field", () => {
    const decoded = {
      userId: "user-123",
      email: "test@test.com",
      iat: 1000000,
      exp: 2000000,
    };

    mockedJwt.verify.mockReturnValue(decoded as never);

    expect(() => verifyRefreshToken("token")).toThrow(
      "Invalid token type: expected refresh token"
    );
  });

  it("throws for expired refresh token", () => {
    const error = new jwt.TokenExpiredError("jwt expired", new Date());
    mockedJwt.verify.mockImplementation(() => {
      throw error;
    });

    expect(() => verifyRefreshToken("expired")).toThrow("Token expired");
  });
});

describe("decodeTokenUnsafe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("decodes a valid token", () => {
    const decoded = {
      userId: "user-123",
      email: "test@test.com",
      iat: 1000,
      exp: 2000,
    };

    mockedJwt.decode.mockReturnValue(decoded as never);

    const result = decodeTokenUnsafe("token");

    expect(result).toEqual(decoded);
  });

  it("returns null for invalid token", () => {
    mockedJwt.decode.mockImplementation(() => {
      throw new Error("invalid");
    });

    const result = decodeTokenUnsafe("garbage");

    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    mockedJwt.decode.mockImplementation(() => {
      throw new Error("invalid");
    });

    const result = decodeTokenUnsafe("");

    expect(result).toBeNull();
  });
});

describe("getTokenExpiration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns expiration date from token", () => {
    const expTimestamp = Math.floor(Date.now() / 1000) + 3600;
    mockedJwt.decode.mockReturnValue({
      userId: "user-1",
      email: "test@test.com",
      exp: expTimestamp,
    } as never);

    const result = getTokenExpiration("token");

    expect(result).toBeInstanceOf(Date);
    expect(result!.getTime()).toBe(expTimestamp * 1000);
  });

  it("returns null for token without exp", () => {
    mockedJwt.decode.mockReturnValue({
      userId: "user-1",
      email: "test@test.com",
    } as never);

    const result = getTokenExpiration("token");

    expect(result).toBeNull();
  });

  it("returns null for invalid token", () => {
    mockedJwt.decode.mockImplementation(() => {
      throw new Error("invalid");
    });

    const result = getTokenExpiration("garbage");

    expect(result).toBeNull();
  });
});

describe("isTokenExpired", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns false for non-expired token", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    mockedJwt.decode.mockReturnValue({
      exp: futureExp,
    } as never);

    expect(isTokenExpired("token")).toBe(false);
  });

  it("returns true for expired token", () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    mockedJwt.decode.mockReturnValue({
      exp: pastExp,
    } as never);

    expect(isTokenExpired("token")).toBe(true);
  });

  it("returns true for token without exp", () => {
    mockedJwt.decode.mockReturnValue({
      userId: "user-1",
    } as never);

    expect(isTokenExpired("token")).toBe(true);
  });

  it("returns true for invalid token", () => {
    mockedJwt.decode.mockImplementation(() => {
      throw new Error("invalid");
    });

    expect(isTokenExpired("garbage")).toBe(true);
  });
});