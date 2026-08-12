import { Router, Request, Response } from "express";
import { randomUUID } from "crypto";
import { getDependencies } from "./dependencies";
import { generateToken } from "../auth/tokens";
import { toUserResponse } from "../models/user.model";
import { rateLimitByKey } from "../auth/middleware";
import logger from "../utils/logger";

const router = Router();

const SANDBOX_TTL_MINUTES = 60;

const demoLimiter = rateLimitByKey(3, 60 * 60 * 1000, (req) => {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
});

router.post("/start", demoLimiter, async (_req: Request, res: Response) => {
  try {
    const { userStore } = getDependencies();

    const email = `sandbox-${randomUUID()}@contextos.local`;
    const password = randomUUID();

    const user = await userStore.createSandboxUser({
      email,
      password,
      displayName: "Sandbox Explorer",
      ttlMinutes: SANDBOX_TTL_MINUTES,
    });

    const token = generateToken(user.userId, user.email);
    const expiresAt = new Date(Date.now() + SANDBOX_TTL_MINUTES * 60 * 1000);

    res.status(201).json({
      token,
      user: toUserResponse(user),
      expiresAt: expiresAt.toISOString(),
      ttlMinutes: SANDBOX_TTL_MINUTES,
    });
  } catch (error) {
    logger.error("POST /demo/start failed", {
      error: (error as Error).message,
    });
    res.status(500).json({ error: "Failed to launch sandbox" });
  }
});

export default router;