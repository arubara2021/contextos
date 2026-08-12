import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../auth/middleware";
import { getDependencies } from "./dependencies";
import logger from "../utils/logger";

const router = Router();

router.get("/check", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const { reminderEngine } = getDependencies();
    const result = await reminderEngine.checkAndGenerate(userId);

    if (!result.hasReminders || !result.reminder) {
      res.status(200).json({
        hasReminders: false,
        reminder: null,
        criticalCount: result.criticalCount,
      });
      return;
    }

    res.status(200).json({
      hasReminders: true,
      reminder: {
        reminderId: result.reminder.reminderId,
        message: result.reminder.message,
        memories: result.reminder.memories.map((m) => ({
          bucketId: m.bucketId,
          canonical: m.canonical,
          strength: m.strength,
          importance: m.importance,
          daysSinceAccess: m.daysSinceAccess,
        })),
        dismissed: result.reminder.dismissed,
        createdAt: result.reminder.createdAt.toISOString(),
      },
      criticalCount: result.criticalCount,
    });
  } catch (error) {
    logger.error("GET /reminders/check failed", {
      userId: req.userId,
      error: (error as Error).message,
    });
    res.status(500).json({ error: "Failed to check reminders" });
  }
});

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const includeAll = req.query.all === "true";

    const { reminderEngine } = getDependencies();

    const reminders = includeAll
      ? await reminderEngine.getAllReminders(userId)
      : await reminderEngine.getActiveReminders(userId);

    res.status(200).json({
      reminders: reminders.map((r) => ({
        reminderId: r.reminderId,
        message: r.message,
        memories: r.memories.map((m) => ({
          bucketId: m.bucketId,
          canonical: m.canonical,
          strength: m.strength,
          importance: m.importance,
          daysSinceAccess: m.daysSinceAccess,
        })),
        dismissed: r.dismissed,
        actionTaken: r.actionTaken,
        createdAt: r.createdAt.toISOString(),
      })),
      count: reminders.length,
    });
  } catch (error) {
    logger.error("GET /reminders failed", {
      userId: req.userId,
      error: (error as Error).message,
    });
    res.status(500).json({ error: "Failed to retrieve reminders" });
  }
});

router.post(
  "/:reminderId/dismiss",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { reminderId } = req.params;

      if (!reminderId) {
        res.status(400).json({ error: "reminderId is required" });
        return;
      }

      const { reminderEngine } = getDependencies();
      const dismissed = await reminderEngine.dismissReminder(reminderId);

      if (!dismissed) {
        res.status(404).json({ error: "Reminder not found" });
        return;
      }

      res.status(200).json({
        message: "Reminder dismissed",
        reminderId,
      });
    } catch (error) {
      logger.error("POST /reminders/:reminderId/dismiss failed", {
        reminderId: req.params.reminderId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to dismiss reminder" });
    }
  }
);

router.post(
  "/:reminderId/action",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { reminderId } = req.params;
      const body = req.body as Record<string, unknown>;

      if (!reminderId) {
        res.status(400).json({ error: "reminderId is required" });
        return;
      }

      if (typeof body.action !== "string") {
        res.status(400).json({
          error: "action is required",
          validActions: ["keep_active", "archive", "boost"],
        });
        return;
      }

      const { reminderEngine, bucketStore, strengthTracker } = getDependencies();

      const validActions = ["keep_active", "archive", "boost"];
      if (!validActions.includes(body.action)) {
        res.status(400).json({
          error: "Invalid action",
          validActions,
        });
        return;
      }

      const success = await reminderEngine.takeAction(reminderId, body.action);

      if (!success) {
        res.status(404).json({ error: "Reminder not found" });
        return;
      }

      if (body.action === "boost" && Array.isArray(body.bucketIds)) {
        const bucketIds = body.bucketIds.filter(
          (id: unknown): id is string => typeof id === "string"
        );

        for (const bucketId of bucketIds) {
          try {
            await strengthTracker.onAccess(bucketId, Date.now());
          } catch (boostError) {
            logger.debug("Failed to boost memory strength", {
              bucketId,
              error: (boostError as Error).message,
            });
          }
        }
      }

      res.status(200).json({
        message: `Action '${body.action}' applied to reminder`,
        reminderId,
        action: body.action,
      });
    } catch (error) {
      logger.error("POST /reminders/:reminderId/action failed", {
        reminderId: req.params.reminderId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to process reminder action" });
    }
  }
);

router.get(
  "/contradictions",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const { reminderEngine } = getDependencies();
      const contradictions = await reminderEngine.getUnresolvedContradictions(userId);

      res.status(200).json({
        contradictions: contradictions.map((c) => ({
          contradictionId: c.contradictionId,
          existingBucketId: c.existingBucketId,
          newInformation: c.newInformation,
          conflictDescription: c.conflictDescription,
          resolved: c.resolved,
          createdAt: c.createdAt.toISOString(),
        })),
        count: contradictions.length,
      });
    } catch (error) {
      logger.error("GET /reminders/contradictions failed", {
        userId: req.userId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to retrieve contradictions" });
    }
  }
);

router.post(
  "/contradictions/:contradictionId/resolve",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { contradictionId } = req.params;

      if (!contradictionId) {
        res.status(400).json({ error: "contradictionId is required" });
        return;
      }

      const { reminderEngine } = getDependencies();
      const resolved = await reminderEngine.resolveContradiction(contradictionId);

      if (!resolved) {
        res.status(404).json({ error: "Contradiction not found" });
        return;
      }

      res.status(200).json({
        message: "Contradiction resolved",
        contradictionId,
      });
    } catch (error) {
      logger.error("POST /reminders/contradictions/:contradictionId/resolve failed", {
        contradictionId: req.params.contradictionId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to resolve contradiction" });
    }
  }
);

export default router;