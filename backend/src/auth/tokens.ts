import jwt from "jsonwebtoken";
import config from "../config";
import logger from "../utils/logger";
import type { TokenPayload } from "../models/user.model";

export type { TokenPayload };

interface GenerateOptions {
  expiresIn?: string;
  audience?: string;
  issuer?: string;
}

interface VerifyOptions {
  audience?: string;
  issuer?: string;
}

const DEFAULT_OPTIONS: GenerateOptions = {
  expiresIn: config.auth.jwtExpiresIn,
  issuer: "contextos-backend",
  audience: "contextos-client",
};

export function generateToken(
  userId: string,
  email: string,
  options?: GenerateOptions
): string {
  if (!userId || !userId.trim()) {
    throw new Error("userId is required for token generation");
  }

  if (!email || !email.trim()) {
    throw new Error("email is required for token generation");
  }

  const opts = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const payload: Omit<TokenPayload, "iat" | "exp"> = {
    userId: userId.trim(),
    email: email.trim().toLowerCase(),
  };

  try {
    const signOptions: jwt.SignOptions = {};

    if (opts.expiresIn) {
      signOptions.expiresIn = opts.expiresIn as jwt.SignOptions["expiresIn"];
    }

    if (opts.issuer) {
      signOptions.issuer = opts.issuer;
    }

    if (opts.audience) {
      signOptions.audience = opts.audience;
    }

    const token = jwt.sign(payload, config.auth.jwtSecret, signOptions);

    logger.debug("Token generated", {
      userId,
      expiresIn: opts.expiresIn,
    });

    return token;
  } catch (error) {
    logger.error("Token generation failed", {
      userId,
      error: (error as Error).message,
    });

    throw new Error("Failed to generate authentication token");
  }
}

export function verifyToken(token: string, options?: VerifyOptions): TokenPayload | null {
  if (!token || !token.trim()) {
    return null;
  }

  try {
    const verifyOptions: jwt.VerifyOptions = {};

    const issuer = options?.issuer ?? DEFAULT_OPTIONS.issuer;
    const audience = options?.audience ?? DEFAULT_OPTIONS.audience;

    if (issuer) {
      verifyOptions.issuer = issuer;
    }

    if (audience) {
      verifyOptions.audience = audience;
    }

    const decoded = jwt.verify(token, config.auth.jwtSecret, verifyOptions);

    if (typeof decoded === "string") {
      logger.warn("Token decoded as string instead of object");
      return null;
    }

    const payload = decoded as TokenPayload;

    if (!payload.userId || !payload.email) {
      logger.warn("Token missing required fields", {
        hasUserId: Boolean(payload.userId),
        hasEmail: Boolean(payload.email),
      });

      return null;
    }

    return {
      userId: payload.userId,
      email: payload.email,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch (error) {
    const err = error as Error;

    if (err.name === "TokenExpiredError") {
      logger.debug("Token expired", {
        error: err.message,
      });

      return null;
    }

    if (err.name === "JsonWebTokenError") {
      logger.debug("Invalid token", {
        error: err.message,
      });

      return null;
    }

    if (err.name === "NotBeforeError") {
      logger.debug("Token not yet valid", {
        error: err.message,
      });

      return null;
    }

    logger.error("Token verification unexpected error", {
      error: err.message,
      name: err.name,
    });

    return null;
  }
}

export function refreshToken(token: string, options?: GenerateOptions): string | null {
  const payload = verifyToken(token);

  if (!payload) {
    return null;
  }

  return generateToken(payload.userId, payload.email, options);
}

export function decodeTokenUnsafe(token: string): TokenPayload | null {
  try {
    const decoded = jwt.decode(token);

    if (!decoded || typeof decoded === "string") {
      return null;
    }

    const payload = decoded as TokenPayload;

    if (!payload.userId || !payload.email) {
      return null;
    }

    return {
      userId: payload.userId,
      email: payload.email,
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function getTokenExpiration(token: string): Date | null {
  const decoded = decodeTokenUnsafe(token);

  if (!decoded?.exp) {
    return null;
  }

  return new Date(decoded.exp * 1000);
}

export function isTokenExpired(token: string): boolean {
  const expiration = getTokenExpiration(token);

  if (!expiration) {
    return true;
  }

  return expiration.getTime() <= Date.now();
}

export function getTokenRemainingSeconds(token: string): number {
  const expiration = getTokenExpiration(token);

  if (!expiration) {
    return 0;
  }

  const remaining = expiration.getTime() - Date.now();

  return Math.max(0, Math.floor(remaining / 1000));
}