import "@lib/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pino from "pino";
import pinoHttp from "pino-http";

import { rateLimiter } from "./middleware/rateLimiter.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";

import authRoutes from "@routes/auth";
// import uploadRoutes from "@routes/upload/index";

import { prisma } from "@lib/prisma";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });
const httpLogger = pinoHttp({ logger, autoLogging: false }); // we use requestLogger for structured entries

export const app = express();

// If behind a reverse proxy (Vercel, Heroku, nginx) enable trust proxy so req.ip is correct
app.set("trust proxy", true);

// Basic security headers
app.use(helmet());

// CORS - restrict origins in production
app.use(
  cors({
    origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",") : true,
    credentials: true,
  })
);

// Compression for responses
app.use(compression());

// Body parsers with safe limits (avoid large JSON bodies causing DoS)
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Pino HTTP middleware (low-level request logging)
app.use(httpLogger);

// Additional request-level business logging (keeps the pino format)
app.use(requestLogger());

// Global (lenient) rate limiter for general protection
app.use(rateLimiter({ windowMs: 60_000, max: 300 }));

/**
 * Mount routes
 *
 * - Auth (request-otp, verify-otp, set-password, password login, refresh, logout, me)
 *   We attach a mild rate limiter on auth routes and rely on more aggressive limits
 *   inside specific handlers (request-otp should have stricter per-phone limits).
 *
 * - Upload routes (presign/complete) — uncomment and mount when implemented.
 */

// Core auth routes (email/password, refresh, logout, me, OTP flows consolidated)
app.use("/api/auth", rateLimiter({ windowMs: 60_000, max: 120 }), authRoutes);

// Upload routes (presign / complete) - keep commented until implemented
// app.use("/api/upload", rateLimiter({ windowMs: 60_000, max: 60 }), uploadRoutes);

// Health check
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// 404 handler — explicit "not found" JSON for unknown routes
app.use((_req, res) => {
  res.status(404).json({
    status: "error",
    error: {
      message: "Not Found",
    },
  });
});

// Central error handler (should be last)
app.use(errorHandler);

/**
 * Graceful shutdown
 * - close DB connections and flush logs before exit
 */
async function shutdown(signal: string) {
  try {
    logger.info({ signal }, "shutdown: signal received, closing resources");
    // Disconnect prisma
    try {
      await prisma.$disconnect();
      logger.info("prisma disconnected");
    } catch (prismaErr) {
      logger.error({ err: prismaErr }, "error disconnecting prisma");
    }
    logger.info("shutdown complete, exiting");
    // give pino a tick to flush
    setTimeout(() => process.exit(0), 200);
  } catch (err) {
    logger.error({ err }, "shutdown error");
    // best-effort exit
    setTimeout(() => process.exit(1), 200);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Export default for convenience if needed
export default app;
