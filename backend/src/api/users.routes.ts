import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest, rateLimitByKey } from "../auth/middleware";
import { getDependencies } from "./dependencies";
import {
  validateUserCreate,
  validateUserUpdate,
  validatePasswordUpdate,
  validateLogin,
  toUserResponse,
} from "../models/user.model";
import { generateToken } from "../auth/tokens";
import { hashPassword, verifyPassword } from "../auth/password";
import logger from "../utils/logger";

const router = Router();

const loginLimiter = rateLimitByKey(8, 15 * 60 * 1000, (req) => {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "unknown";
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return `login:${ip}:${email}`;
});

const registerLimiter = rateLimitByKey(5, 60 * 60 * 1000, (req) => {
  const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";
  return `register:${ip}`;
});

function applySecureHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
}

router.post(
  "/register",
  registerLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      applySecureHeaders(res);

      const { params, errors } = validateUserCreate(req.body);

      if (!params) {
        res.status(400).json({ error: "Validation failed", details: errors });
        return;
      }

      const { userStore } = getDependencies();

      const emailExists = await userStore.emailExists(params.email);

      if (emailExists) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }

      const passwordHash = await hashPassword(params.password!);

      const user = await userStore.createUser({
        ...params,
        passwordHash,
      });

      const token = generateToken(user.userId, user.email);

      res.status(201).json({
        user: toUserResponse(user),
        token,
      });
    } catch (error) {
      const err = error as Error;

      if (err.message.includes("Email already registered")) {
        res.status(409).json({ error: err.message });
        return;
      }

      logger.error("POST /users/register failed", {
        email: typeof req.body?.email === "string" ? req.body.email.toLowerCase() : undefined,
        error: err.message,
      });

      res.status(500).json({ error: "Failed to register user" });
    }
  }
);

router.post(
  "/login",
  loginLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      applySecureHeaders(res);

      const loginParams = validateLogin(req.body);

      if (!loginParams) {
        res.status(400).json({
          error: "Invalid request",
          details: "Required fields: email (string), password (string)",
        });
        return;
      }

      const { userStore } = getDependencies();

      const user = await userStore.getUserByEmail(loginParams.email);

      if (!user) {
        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const passwordValid = await verifyPassword(loginParams.password, user.passwordHash);

      if (!passwordValid) {
        logger.warn("Failed login attempt", {
          email: loginParams.email,
          ip: req.ip ?? req.socket.remoteAddress ?? "unknown",
        });

        res.status(401).json({ error: "Invalid email or password" });
        return;
      }

      const token = generateToken(user.userId, user.email);

      res.status(200).json({
        user: toUserResponse(user),
        token,
      });
    } catch (error) {
      logger.error("POST /users/login failed", {
        email: typeof req.body?.email === "string" ? req.body.email.toLowerCase() : undefined,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to login" });
    }
  }
);

router.get("/me", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    applySecureHeaders(res);

    const userId = req.userId!;
    const { userStore } = getDependencies();

    const user = await userStore.getUserById(userId);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({
      user: toUserResponse(user),
    });
  } catch (error) {
    logger.error("GET /users/me failed", {
      userId: req.userId,
      error: (error as Error).message,
    });

    res.status(500).json({ error: "Failed to retrieve user profile" });
  }
});

router.patch("/me", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    applySecureHeaders(res);

    const userId = req.userId!;

    const { params, errors } = validateUserUpdate(req.body);

    if (!params) {
      res.status(400).json({ error: "Validation failed", details: errors });
      return;
    }

    const { userStore } = getDependencies();

    if (params.email) {
      const emailExists = await userStore.emailExists(params.email);

      if (emailExists) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
    }

    const updated = await userStore.updateUser(userId, params);

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.status(200).json({
      user: toUserResponse(updated),
    });
  } catch (error) {
    const err = error as Error;

    if (err.message.includes("Email already registered")) {
      res.status(409).json({ error: err.message });
      return;
    }

    logger.error("PATCH /users/me failed", {
      userId: req.userId,
      error: err.message,
    });

    res.status(500).json({ error: "Failed to update user profile" });
  }
});

router.patch(
  "/me/password",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      applySecureHeaders(res);

      const userId = req.userId!;

      const { params, errors } = validatePasswordUpdate(req.body);

      if (!params) {
        res.status(400).json({ error: "Validation failed", details: errors });
        return;
      }

      const { userStore } = getDependencies();

      const user = await userStore.getUserById(userId);

      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const currentValid = await verifyPassword(params.currentPassword, user.passwordHash);

      if (!currentValid) {
        res.status(401).json({ error: "Current password is incorrect" });
        return;
      }

      const newHash = await hashPassword(params.newPassword);

      const updated = await userStore.updatePassword(userId, newHash);

      if (!updated) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      res.status(200).json({
        message: "Password updated successfully",
      });
    } catch (error) {
      logger.error("PATCH /users/me/password failed", {
        userId: req.userId,
        error: (error as Error).message,
      });

      res.status(500).json({ error: "Failed to update password" });
    }
  }
);

export default router;