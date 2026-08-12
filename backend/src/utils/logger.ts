import winston from "winston";
import config from "../config";

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  config.server.isProduction
    ? winston.format.json()
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
          return `${timestamp} [${level}] ${message}${metaStr}`;
        })
      )
);

const logger = winston.createLogger({
  level: config.server.isProduction ? "info" : "debug",
  format: logFormat,
  defaultMeta: { service: "contextos-backend" },
  transports: [
    new winston.transports.Console({
      handleExceptions: true,
      handleRejections: true,
    }),
  ],
});

if (config.server.isProduction) {
  logger.add(
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    })
  );
  logger.add(
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
      tailable: true,
    })
  );
}

export default logger;