import { Router, Request, Response } from "express";
import { getDependencies } from "./dependencies";
import { generateToken } from "../auth/tokens";
import { toUserResponse } from "../models/user.model";
import { rateLimitByKey } from "../auth/middleware";
import config from "../config";
import logger from "../utils/logger";

const router = Router();

// Shared sandbox: everyone gets the SAME user
// Rate limit is lenient because this endpoint is now idempotent
const demoLimiter = rateLimitByKey(100, 60 * 60 * 1000, (req) => {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
});

router.post("/start", demoLimiter, async (_req: Request, res: Response) => {
  try {
    const { userStore } = getDependencies();

    const sharedEmail = config.sandbox.sharedEmail;

    if (!sharedEmail) {
      res.status(500).json({ error: "Shared sandbox not configured" });
      return;
    }

    // Always returns the SAME user — never creates a new one per device
    const user = await userStore.getOrCreateSharedSandboxUser(sharedEmail);

    const token = generateToken(user.userId, user.email);

    res.status(200).json({
      token,
      user: toUserResponse(user),
      expiresAt: null, // shared sandbox does not expire
      ttlMinutes: 0,   // no TTL for shared
    });
  } catch (error) {
    logger.error("POST /demo/start failed", {
      error: (error as Error).message,
    });
    res.status(500).json({ error: "Failed to launch sandbox" });
  }
});

export default router;