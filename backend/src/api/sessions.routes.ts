import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../auth/middleware";
import { getDependencies } from "./dependencies";
import { validateSessionCreate, validateSessionUpdate } from "../models/session.model";
import logger from "../utils/logger";

const router = Router();

router.get("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;

    const { sessionStore } = getDependencies();
    const sessions = await sessionStore.getSessionsByUser(userId);

    res.status(200).json({
      sessions: sessions.map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        messageCount: s.messageCount,
        lastMessage: s.lastMessage,
        lastMessageRole: s.lastMessageRole,
        lastMessageAt: s.lastMessageAt?.toISOString() ?? null,
      })),
      count: sessions.length,
    });
  } catch (error) {
    logger.error("GET /sessions failed", {
      userId: req.userId,
      error: (error as Error).message,
    });
    res.status(500).json({ error: "Failed to retrieve sessions" });
  }
});

router.post("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const body = req.body as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title.trim() : undefined;

    if (title && title.length > 500) {
      res.status(400).json({ error: "Title must be 500 characters or less" });
      return;
    }

    const { sessionStore } = getDependencies();
    const session = await sessionStore.createSession(userId, title);

    res.status(201).json({
      sessionId: session.sessionId,
      title: session.title,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      messageCount: session.messageCount,
    });
  } catch (error) {
    logger.error("POST /sessions failed", {
      userId: req.userId,
      error: (error as Error).message,
    });
    res.status(500).json({ error: "Failed to create session" });
  }
});

router.get(
  "/:sessionId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { sessionId } = req.params;
      const userId = req.userId!;

      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }

      const { sessionStore } = getDependencies();

      const belongs = await sessionStore.belongsToUser(sessionId, userId);
      if (!belongs) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const session = await sessionStore.getSessionWithPreview(sessionId);

      if (!session) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.status(200).json({
        sessionId: session.sessionId,
        title: session.title,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        messageCount: session.messageCount,
        lastMessage: session.lastMessage,
        lastMessageRole: session.lastMessageRole,
        lastMessageAt: session.lastMessageAt?.toISOString() ?? null,
      });
    } catch (error) {
      logger.error("GET /sessions/:sessionId failed", {
        sessionId: req.params.sessionId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to retrieve session" });
    }
  }
);

router.patch(
  "/:sessionId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { sessionId } = req.params;
      const userId = req.userId!;

      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }

      const validated = validateSessionUpdate(req.body);

      if (!validated) {
        res.status(400).json({
          error: "Invalid request",
          details: "title must be a non-empty string (max 500 characters)",
        });
        return;
      }

      const { sessionStore } = getDependencies();

      const belongs = await sessionStore.belongsToUser(sessionId, userId);
      if (!belongs) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const updated = await sessionStore.updateSession(sessionId, validated.title!);

      if (!updated) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.status(200).json({
        sessionId: updated.sessionId,
        title: updated.title,
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
        messageCount: updated.messageCount,
      });
    } catch (error) {
      logger.error("PATCH /sessions/:sessionId failed", {
        sessionId: req.params.sessionId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to update session" });
    }
  }
);

router.delete(
  "/:sessionId",
  authMiddleware,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { sessionId } = req.params;
      const userId = req.userId!;

      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required" });
        return;
      }

      const { sessionStore } = getDependencies();

      const belongs = await sessionStore.belongsToUser(sessionId, userId);
      if (!belongs) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      const deleted = await sessionStore.deleteSession(sessionId);

      if (!deleted) {
        res.status(404).json({ error: "Session not found" });
        return;
      }

      res.status(200).json({
        message: "Session deleted",
        sessionId,
      });
    } catch (error) {
      logger.error("DELETE /sessions/:sessionId failed", {
        sessionId: req.params.sessionId,
        error: (error as Error).message,
      });
      res.status(500).json({ error: "Failed to delete session" });
    }
  }
);

export default router;