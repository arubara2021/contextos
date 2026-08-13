import "dotenv/config";
import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../auth/tokens";
import type { TokenPayload } from "../models/user.model";
import { getUserStore } from "../storage/user-store";
import logger from "../utils/logger";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  tokenPayload?: TokenPayload;
}

const DEV_BYPASS_AUTH = ["true", "1", "yes"].includes(
  (process.env.DEV_BYPASS_AUTH ?? "false").toLowerCase().trim()
);

const DEV_BYPASS_TOKEN = process.env.DEV_BYPASS_TOKEN ?? "dev-bypass-token";
const DEV_BYPASS_EMAIL = process.env.DEV_BYPASS_EMAIL ?? "demo@contextos.local";

let devUserCache: { userId: string; email: string } | null | undefined = undefined;

async function resolveDevUser(): Promise<{ userId: string; email: string } | null> {
  if (devUserCache) {
    return devUserCache;
  }

  try {
    let user = await getUserStore().getUserByEmail(DEV_BYPASS_EMAIL);

    if (!user) {
      logger.info("Dev bypass: demo user not found, creating...");
      try {
        user = await getUserStore().createUser({
          email: DEV_BYPASS_EMAIL,
          passwordHash: "dev-bypass-no-login",
          displayName: "Vera Lindqvist",
        });
        logger.info("Dev bypass: demo user created", { userId: user.userId });
      } catch (createErr) {
        // User might have been created by a race condition, try again
        user = await getUserStore().getUserByEmail(DEV_BYPASS_EMAIL);
        if (!user) {
          devUserCache = null;
          logger.error("Dev bypass: failed to create demo user", {
            error: (createErr as Error).message,
          });
          return null;
        }
      }
    }

    devUserCache = {
      userId: user.userId,
      email: user.email,
    };

    logger.info("Dev bypass resolved demo user", {
      userId: user.userId,
      email: user.email,
    });

    return devUserCache;
  } catch (error) {
    devUserCache = null;
    logger.error("Dev bypass user resolution failed", {
      error: (error as Error).message,
    });
    return null;
  }
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.status(401).json({ error: "Authorization header required" });
    return;
  }

  const parts = authHeader.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer") {
    res.status(401).json({ error: "Authorization header must be: Bearer <token>" });
    return;
  }

  const token = parts[1];

  if (!token || token.length === 0) {
    res.status(401).json({ error: "Token is empty" });
    return;
  }

  if (DEV_BYPASS_AUTH && token === DEV_BYPASS_TOKEN) {
    const dev = await resolveDevUser();

    if (!dev) {
      res.status(401).json({
        error: "Dev bypass enabled but demo user missing",
        details: `Run: npx ts-node src/scripts/seed-demo.ts (expected email: ${DEV_BYPASS_EMAIL})`,
      });
      return;
    }

    req.userId = dev.userId;
    req.userEmail = dev.email;
    req.tokenPayload = {
      userId: dev.userId,
      email: dev.email,
    };

    next();
    return;
  }

  try {
    const payload = verifyToken(token);

    if (!payload) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    req.userId = payload.userId;
    req.userEmail = payload.email;
    req.tokenPayload = payload;

    next();
  } catch (error) {
    const err = error as Error;

    if (err.name === "TokenExpiredError") {
      logger.debug("Token expired", {
        path: req.path,
        method: req.method,
      });

      res.status(401).json({ error: "Token expired" });
      return;
    }

    if (err.name === "JsonWebTokenError") {
      logger.debug("Invalid token", {
        path: req.path,
        method: req.method,
        error: err.message,
      });

      res.status(401).json({ error: "Invalid token" });
      return;
    }

    logger.error("Auth middleware unexpected error", {
      path: req.path,
      method: req.method,
      error: err.message,
    });

    res.status(500).json({ error: "Authentication error" });
  }
}

export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next();
    return;
  }

  const parts = authHeader.split(" ");

  if (parts.length !== 2 || parts[0] !== "Bearer") {
    next();
    return;
  }

  const token = parts[1];

  if (!token || token.length === 0) {
    next();
    return;
  }

  if (DEV_BYPASS_AUTH && token === DEV_BYPASS_TOKEN) {
    const dev = await resolveDevUser();

    if (dev) {
      req.userId = dev.userId;
      req.userEmail = dev.email;
      req.tokenPayload = {
        userId: dev.userId,
        email: dev.email,
      };
    }

    next();
    return;
  }

  try {
    const payload = verifyToken(token);

    if (payload) {
      req.userId = payload.userId;
      req.userEmail = payload.email;
      req.tokenPayload = payload;
    }
  } catch {
    logger.debug("Optional auth: token invalid, continuing without auth", {
      path: req.path,
    });
  }

  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const userRole = (req.tokenPayload as TokenPayload & { role?: string })?.role;

    if (!userRole || !roles.includes(userRole)) {
      logger.warn("Role authorization failed", {
        userId: req.userId,
        requiredRoles: roles,
        userRole,
        path: req.path,
      });

      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }

    next();
  };
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

export function rateLimitByKey(
  maxRequests: number = 60,
  windowMs: number = 60000,
  keyGenerator: (req: AuthenticatedRequest) => string = (req) => {
    return (
      req.userId ??
      req.userEmail ??
      req.ip ??
      req.socket.remoteAddress ??
      "anonymous"
    );
  }
) {
  const requests = new Map<string, RateLimitEntry>();

  const timer = setInterval(() => {
    const now = Date.now();

    for (const [key, value] of requests) {
      if (value.resetAt <= now) {
        requests.delete(key);
      }
    }
  }, Math.min(windowMs, 60000));

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();

    let entry = requests.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = {
        count: 0,
        resetAt: now + windowMs,
      };

      requests.set(key, entry);
    }

    entry.count += 1;

    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - entry.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(entry.resetAt / 1000));

    if (entry.count > maxRequests) {
      logger.warn("Rate limit exceeded", {
        key,
        count: entry.count,
        maxRequests,
        path: req.path,
      });

      res.status(429).json({
        error: "Too many requests",
        details: "Please slow down and try again shortly.",
      });

      return;
    }

    next();
  };
}

export function rateLimitByUser(maxRequests: number = 60, windowMs: number = 60000) {
  return rateLimitByKey(maxRequests, windowMs, (req) => {
    return (
      req.userId ??
      req.userEmail ??
      req.ip ??
      req.socket.remoteAddress ??
      "unknown"
    );
  });
}