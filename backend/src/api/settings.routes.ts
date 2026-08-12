import { Router, Response } from "express";
import { authMiddleware, AuthenticatedRequest } from "../auth/middleware";
import { getDependencies } from "./dependencies";
import config from "../config";
import logger from "../utils/logger";

const router = Router();

router.get("/", authMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const { modelRouter, strengthTracker } = getDependencies();

    const availableModels = modelRouter.getAvailableModels().map((m) => ({
      key: m.key,
      displayName: m.config.displayName,
      provider: m.config.provider,
      maxTokens: m.config.maxTokens,
    }));

    const { summary } = await strengthTracker.bulkStatus();

    res.status(200).json({
      models: {
        available: availableModels,
        default: modelRouter.getDefaultModel(),
      },
      memory: {
        maxContextMemories: config.memory.maxContextMemories,
        chunkTargetMin: config.memory.chunkTargetMin,
        chunkTargetMax: config.memory.chunkTargetMax,
      },
      decay: {
        defaultRate: config.decay.defaultRate,
        highImportanceRate: config.decay.highImportanceRate,
        lowImportanceRate: config.decay.lowImportanceRate,
        strongThreshold: config.decay.strongThreshold,
        fadingThreshold: config.decay.fadingThreshold,
        criticalThreshold: config.decay.criticalThreshold,
        forgottenThreshold: config.decay.forgottenThreshold,
      },
      scorer: {
        semanticWeight: config.scorer.semanticWeight,
        strengthWeight: config.scorer.strengthWeight,
        recencyWeight: config.scorer.recencyWeight,
      },
      reminders: {
        checkIntervalHours: config.reminder.checkIntervalHours,
        minImportance: config.reminder.minImportance,
      },
      currentStats: summary,
    });
  } catch (error) {
    logger.error("GET /settings failed", {
      error: (error as Error).message,
    });
    res.status(500).json({ error: "Failed to retrieve settings" });
  }
});

router.patch("/", authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body as Record<string, unknown>;
    const updated: Record<string, unknown> = {};

    if (body.maxContextMemories !== undefined) {
      const num = Number(body.maxContextMemories);
      if (isNaN(num) || num < 1 || num > 100) {
        res.status(400).json({ error: "maxContextMemories must be between 1 and 100" });
        return;
      }
      updated.maxContextMemories = num;
    }

    if (body.checkIntervalHours !== undefined) {
      const num = Number(body.checkIntervalHours);
      if (isNaN(num) || num < 1 || num > 168) {
        res.status(400).json({ error: "checkIntervalHours must be between 1 and 168" });
        return;
      }
      updated.checkIntervalHours = num;
    }

    if (body.strongThreshold !== undefined) {
      const num = Number(body.strongThreshold);
      if (isNaN(num) || num < 0 || num > 1) {
        res.status(400).json({ error: "strongThreshold must be between 0 and 1" });
        return;
      }
      updated.strongThreshold = num;
    }

    if (body.fadingThreshold !== undefined) {
      const num = Number(body.fadingThreshold);
      if (isNaN(num) || num < 0 || num > 1) {
        res.status(400).json({ error: "fadingThreshold must be between 0 and 1" });
        return;
      }
      updated.fadingThreshold = num;
    }

    if (body.semanticWeight !== undefined) {
      const num = Number(body.semanticWeight);
      if (isNaN(num) || num < 0 || num > 1) {
        res.status(400).json({ error: "semanticWeight must be between 0 and 1" });
        return;
      }
      updated.semanticWeight = num;
    }

    if (body.strengthWeight !== undefined) {
      const num = Number(body.strengthWeight);
      if (isNaN(num) || num < 0 || num > 1) {
        res.status(400).json({ error: "strengthWeight must be between 0 and 1" });
        return;
      }
      updated.strengthWeight = num;
    }

    if (body.recencyWeight !== undefined) {
      const num = Number(body.recencyWeight);
      if (isNaN(num) || num < 0 || num > 1) {
        res.status(400).json({ error: "recencyWeight must be between 0 and 1" });
        return;
      }
      updated.recencyWeight = num;
    }

    if (Object.keys(updated).length === 0) {
      res.status(400).json({
        error: "No valid settings provided",
        updatableFields: [
          "maxContextMemories",
          "checkIntervalHours",
          "strongThreshold",
          "fadingThreshold",
          "semanticWeight",
          "strengthWeight",
          "recencyWeight",
        ],
      });
      return;
    }

    logger.info("Settings updated", { updated });

    res.status(200).json({
      message: "Settings updated",
      updated,
      note: "Runtime changes apply to this session only. Update environment variables for permanent changes.",
    });
  } catch (error) {
    logger.error("PATCH /settings failed", {
      error: (error as Error).message,
    });
    res.status(500).json({ error: "Failed to update settings" });
  }
});

export default router;