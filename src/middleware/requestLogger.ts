// src/middleware/requestLogger.ts
import type { Request, Response, NextFunction } from "express";
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

export function requestLogger() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const latency = Date.now() - start;
      logger.info(
        {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          latency,
        },
        "http_request"
      );
    });
    next();
  };
}
