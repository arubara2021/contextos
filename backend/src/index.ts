import app from "./app";
import config from "./config";
import logger from "./utils/logger";
import { initPool, closePool, healthCheck } from "./database";
import { initializeDependencies } from "./api/dependencies";

async function main() {
  try {
    logger.info("Starting ContextOS backend...");

    logger.info("Connecting to database...");
    initPool();
    const health = await healthCheck();
    if (!health.healthy) {
      throw new Error(`Database connection failed: ${health.error}`);
    }
    logger.info("Database connected", { latencyMs: health.latencyMs });

    logger.info("Initializing dependencies...");
    initializeDependencies();

    const server = app.listen(config.server.port, () => {
      logger.info(`Server started on port ${config.server.port}`, {
        env: config.server.nodeEnv,
      });
    });

    const shutdown = async (signal: string) => {
      logger.info(`${signal} received, shutting down gracefully`);
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
  } catch (error) {
    logger.error("Failed to start server", {
      error: (error as Error).message,
    });
    process.exit(1);
  }
}

main();