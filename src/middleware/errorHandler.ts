// src/middleware/errorHandler.ts
import type { Request, Response, NextFunction } from "express";
import pino from "pino";
import { APIError } from "@utils/errors";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // Unknown / unexpected errors
  if (!(err instanceof APIError)) {
    logger.error({ err, path: req.path, method: req.method }, "Unhandled error");
    const message = (err && (err as Error).message) || "Internal Server Error";
    return res.status(500).json({
      status: "error",
      error: {
        message,
      },
    });
  }

  // APIError: known shape
  const apiErr = err as APIError;
  logger.warn(
    { err: apiErr, path: req.path, method: req.method },
    "Handled API error"
  );

  return res.status(apiErr.status).json({
    status: "error",
    error: {
      message: apiErr.message,
      code: apiErr.code,
      details: apiErr.details,
    },
  });
}
