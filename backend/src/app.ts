import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import config from "./config";
import logger from "./utils/logger";
import chatRoutes from "./api/chat.routes";
import memoriesRoutes from "./api/memories.routes";
import sessionsRoutes from "./api/sessions.routes";
import documentsRoutes from "./api/documents.routes";
import remindersRoutes from "./api/reminders.routes";
import settingsRoutes from "./api/settings.routes";
import usersRoutes from "./api/users.routes";
import exportRoutes from "./api/export.routes";
import healthRoutes from "./api/health.routes";
import demoRoutes from "./api/demo.routes";

const app = express();

app.use(helmet());

app.use(
  cors({
    origin: config.cors.frontendUrl,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use((req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  const originalEnd = _res.end.bind(_res);
  _res.end = function (...args: Parameters<typeof originalEnd>) {
    const duration = Date.now() - start;
    if (duration > 5000) {
      logger.warn("Request exceeded 5s", {
        method: req.method,
        path: req.path,
        duration,
        status: _res.statusCode,
      });
    }
    return originalEnd(...args);
  } as typeof originalEnd;
  next();
});

app.use("/api/health", healthRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/memories", memoriesRoutes);
app.use("/api/sessions", sessionsRoutes);
app.use("/api/documents", documentsRoutes);
app.use("/api/reminders", remindersRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/users", usersRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/demo", demoRoutes);

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found", path: _req.path });
});

interface AppError extends Error {
  statusCode?: number;
  code?: string;
  detail?: string;
}

app.use((err: AppError, req: Request, res: Response, _next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const isServerError = statusCode >= 500;

  if (isServerError) {
    logger.error("Unhandled server error", {
      method: req.method,
      path: req.path,
      error: err.message,
      code: err.code,
      stack: err.stack,
    });
  } else {
    logger.warn("Client error", {
      method: req.method,
      path: req.path,
      status: statusCode,
      error: err.message,
    });
  }

  res.status(statusCode).json({
    error: isServerError ? "Internal server error" : err.message,
    ...(config.server.isProduction ? {} : { detail: err.detail, stack: err.stack }),
  });
});

export default app;